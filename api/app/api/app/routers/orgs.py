"""Org-scoped routes.

Route permission matrix (from seed file):
  GET  /orgs                           — authenticated only (own data)
  GET  /orgs/{org_id}/teams            — requires "team.manage" (scope: org)
  GET  /orgs/{org_id}/permissions      — requires "org.view" (scope: org)
  GET  /orgs/{org_id}/teams/{team_id}/permissions — requires "team.view" (scope: team)
"""
from __future__ import annotations

import datetime
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Response, status
from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.orm import joinedload

from app.api.app.access import CurrentUser
from app.api.app.schemas import (
    AddTeamMemberRequest,
    AssignTeamLeadRequest,
    AuthorInfo,
    CompletePlanRequest,
    CreateOrgRequest,
    CreateOrgResponse,
    CreatePlanRequest,
    CreateTeamRequest,
    DeleteOrgRequest,
    DeletePlanRequest,
    MemberOut,
    MembershipInfoResponse,
    MyTeamResponse,
    OrgDetailResponse,
    OrgInfoResponse,
    OrgMembershipResponse,
    OrgOut,
    PermissionScopeResponse,
    PlanOut,
    PlanSummary,
    ReturnPlanRequest,
    TaskIn,
    TaskOut,
    TeamDetailResponse,
    TeamHistoryWeekSummary,
    TeamLeadInfo,
    TeamLeadResponse,
    TeamMemberOut,
    TeamOut,
    TeamPlanOut,
    TeamPlanSummaryOut,
    TeamResponse,
    TeamWeekMember,
    TeamWeekTotals,
    TeamWeekViewOut,
    TransferOwnershipRequest,
    UpdateMemberRoleRequest,
    UpdateMemberStatusRequest,
    UpdateOrgRequest,
    UpdatePlanRequest,
    UpdateTaskStatusRequest,
    UpdateTeamMemberStatusRequest,
    UpdateTeamRequest,
)
from app.database import DBSession
from app.exceptions import APIException
from app.models import Membership, Organization, Permission, Plan, PlanTask, Role, RolePermission, Team, TeamMember, User
from app.rbac import (
    RequirePermission,
    RequireTeamViewOrOrgManage,
    get_permissions_for_roles,
    resolve_org_role,
    resolve_team_role,
)
from app.schemas import PaginatedResponse

router = APIRouter(tags=["orgs"])


# ---------------------------------------------------------------------------
# 1. List caller's orgs — own data, no extra permission needed beyond login
# ---------------------------------------------------------------------------

@router.get("/orgs")
async def list_member_orgs(
    current_user: CurrentUser,
    session: DBSession,
) -> list[OrgMembershipResponse]:
    """Return every org the calling user belongs to, with role and membership info."""
    rows = await session.execute(
        select(Membership, Organization, Role)
        .join(Organization, Organization.id == Membership.org_id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.user_id == current_user.id)
        .order_by(Organization.name)
    )

    result: list[OrgMembershipResponse] = []
    for membership, org, role in rows:
        result.append(
            OrgMembershipResponse(
                org_info=OrgInfoResponse(
                    org_id=org.id,
                    org_name=org.name,
                    address=org.address,
                    is_suspended=org.is_suspended,
                    logo_url=org.logo_url,
                    role_name=role.name,
                ),
                membership=MembershipInfoResponse(
                    membership_id=membership.id,
                    membership_status=membership.status,
                ),
            )
        )
    return result


# ---------------------------------------------------------------------------
# 2. View org teams — requires "team.manage" in the org scope
#    Selects teams the caller's membership belongs to within the org.
# ---------------------------------------------------------------------------

@router.get(
    "/orgs/{org_id}/teams",
    dependencies=[Depends(RequirePermission("team.manage", allowed_scopes="org"))],
)
async def view_org_teams(
    org_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> list[TeamResponse]:
    """List all teams in the org that the calling user's membership is in.

    Access: requires ``team.manage`` permission in the org scope.
    Teams are filtered to those within the organisation; the caller's own
    membership row is used to confirm they belong to this org.
    """
    # Verify caller is a member of this org (guard against id probing)
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.org_id == org_id,
            Membership.status == "active",
        )
    )
    if membership is None:
        from app.exceptions import APIException
        from fastapi import status
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ORG_NOT_FOUND",
            message="Organization not found or you are not a member.",
        )

    # Count members per team in a subquery
    member_count_sq = (
        select(TeamMember.team_id, func.count(TeamMember.id).label("cnt"))
        .where(TeamMember.org_id == org_id)
        .group_by(TeamMember.team_id)
        .subquery()
    )

    rows = await session.execute(
        select(Team, member_count_sq.c.cnt)
        .outerjoin(member_count_sq, member_count_sq.c.team_id == Team.id)
        .where(Team.org_id == org_id)
        .order_by(Team.name)
    )

    result: list[TeamResponse] = []
    for team, cnt in rows:
        lead_resp: TeamLeadResponse | None = None
        if team.lead_member_id:
            lead_row = await session.execute(
                select(Membership, User)
                .join(User, User.id == Membership.user_id)
                .where(Membership.id == team.lead_member_id)
            )
            lead_data = lead_row.first()
            if lead_data:
                lead_mem, lead_user = lead_data
                lead_resp = TeamLeadResponse(
                    membership_id=lead_mem.id,
                    user_id=lead_user.id,
                    first_name=lead_user.first_name,
                    last_name=lead_user.last_name,
                    email=lead_user.email,
                )

        result.append(
            TeamResponse(
                team_id=team.id,
                team_name=team.name,
                org_id=team.org_id,
                lead=lead_resp,
                member_count=cnt or 0,
            )
        )
    return result


# ---------------------------------------------------------------------------
# 3a. Get permissions for the caller in an org — requires "org.view" (org scope)
# ---------------------------------------------------------------------------

@router.get(
    "/orgs/{org_id}/permissions",
    dependencies=[Depends(RequirePermission("org.view", allowed_scopes="org"))],
)
async def get_org_permissions(
    org_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> list[PermissionScopeResponse]:
    """Return the caller's permission codes for the given org (scope=org).

    Access: requires ``org.view``.
    """
    org_role_id = await resolve_org_role(
        session, current_user.id, org_id=str(org_id)
    )
    result: list[PermissionScopeResponse] = []
    if org_role_id:
        org_perms = await get_permissions_for_roles(session, [org_role_id])
        result.append(
            PermissionScopeResponse(scope="org", permission_codes=sorted(org_perms))
        )
    return result


# ---------------------------------------------------------------------------
# 3b. Get permissions for the caller in a specific team — requires "team.view" (team scope)
# ---------------------------------------------------------------------------

@router.get(
    "/orgs/{org_id}/teams/{team_id}/permissions",
    dependencies=[Depends(RequirePermission("team.view", allowed_scopes="team"))],
)
async def get_team_permissions(
    org_id: UUID,
    team_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> list[PermissionScopeResponse]:
    """Return the caller's permission codes for the given org and team.

    Returns two entries when the caller holds both an org role and a team role:
    one for scope=``org`` and one for scope=``team``.

    Access: requires ``team.view`` (team scope).
    """
    result: list[PermissionScopeResponse] = []

    # Org scope permissions
    org_role_id = await resolve_org_role(
        session, current_user.id, org_id=str(org_id)
    )
    if org_role_id:
        org_perms = await get_permissions_for_roles(session, [org_role_id])
        result.append(
            PermissionScopeResponse(scope="org", permission_codes=sorted(org_perms))
        )

    # Team scope permissions
    team_role_id = await resolve_team_role(
        session, current_user.id, team_id=str(team_id)
    )
    if team_role_id:
        team_perms = await get_permissions_for_roles(session, [team_role_id])
        result.append(
            PermissionScopeResponse(scope="team", permission_codes=sorted(team_perms))
        )

    return result


# ---------------------------------------------------------------------------
# 4. Create organization — Authenticated
# ---------------------------------------------------------------------------

@router.post("/orgs", status_code=status.HTTP_201_CREATED)
async def create_org(
    body: CreateOrgRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> CreateOrgResponse:
    """Create an organization and make the calling user its owner.

    Creating the org and the owner membership happen in one transaction.
    The role is the system owner role (scope='org', org_id null).
    """
    owner_role = await session.scalar(
        select(Role).where(
            Role.name == "owner",
            Role.scope == "org",
            Role.is_sys.is_(True),
            Role.org_id.is_(None),
        )
    )
    if not owner_role:
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="ROLE_NOT_FOUND",
            message="System owner role is not configured.",
        )

    org = Organization(
        name=body.name,
        address=body.address,
        logo_url=body.logo_url,
        is_suspended=False,
    )
    session.add(org)
    await session.flush()

    membership = Membership(
        user_id=current_user.id,
        org_id=org.id,
        role_id=owner_role.id,
        status="active",
    )
    session.add(membership)
    await session.flush()
    await session.commit()
    await session.refresh(org)
    await session.refresh(membership)

    return CreateOrgResponse(
        id=org.id,
        name=org.name,
        address=org.address,
        logo_url=org.logo_url,
        is_suspended=org.is_suspended,
        created_at=org.created_at,
        role="owner",
        membership_id=membership.id,
    )


# ---------------------------------------------------------------------------
# 5. Get organization details — requires "org.view" (org scope)
# ---------------------------------------------------------------------------

@router.get(
    "/orgs/{org_id}",
    dependencies=[Depends(RequirePermission("org.view", allowed_scopes="org"))],
)
async def get_org(
    org_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> OrgDetailResponse:
    """Return organization details and the caller's role in the organization."""
    org = await session.get(Organization, org_id)
    if not org:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ORG_NOT_FOUND",
            message="Organization not found.",
        )

    membership = await session.scalar(
        select(Membership)
        .where(
            Membership.user_id == current_user.id,
            Membership.org_id == org_id,
            Membership.status == "active",
        )
    )
    role_name = "member"
    if membership:
        role = await session.get(Role, membership.role_id)
        if role:
            role_name = role.name

    return OrgDetailResponse(
        id=org.id,
        name=org.name,
        address=org.address,
        logo_url=org.logo_url,
        is_suspended=org.is_suspended,
        created_at=org.created_at,
        my_role=role_name,
    )


# ---------------------------------------------------------------------------
# 6. Update organization settings — requires "org.settings" (org scope)
# ---------------------------------------------------------------------------

@router.patch(
    "/orgs/{org_id}",
    dependencies=[Depends(RequirePermission("org.settings", allowed_scopes="org"))],
)
async def update_org(
    org_id: UUID,
    body: UpdateOrgRequest,
    session: DBSession,
) -> OrgOut:
    """Update organization settings (name, address, logo_url).

    Access: requires ``org.settings`` permission in org scope.
    """
    org = await session.get(Organization, org_id)
    if not org:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ORG_NOT_FOUND",
            message="Organization not found.",
        )

    if body.name is not None:
        org.name = body.name
    if body.address is not None:
        org.address = body.address
    if body.logo_url is not None:
        org.logo_url = body.logo_url

    await session.flush()
    await session.commit()
    await session.refresh(org)

    return OrgOut(
        id=org.id,
        name=org.name,
        address=org.address,
        logo_url=org.logo_url,
        is_suspended=org.is_suspended,
        created_at=org.created_at,
    )


# ---------------------------------------------------------------------------
# 7. Leave organization — requires "org.view" (org scope)
# ---------------------------------------------------------------------------

@router.post(
    "/orgs/{org_id}/leave",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(RequirePermission("org.view", allowed_scopes="org"))],
)
async def leave_org(
    org_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> Response:
    """Leave an organization.

    If the caller is the last owner, return 409.
    Leaving deletes their membership, team rows and plans.
    """
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.org_id == org_id,
            Membership.status == "active",
        )
    )
    if not membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBERSHIP_NOT_FOUND",
            message="Membership not found or inactive.",
        )

    # Check if caller is owner
    owner_role = await session.scalar(
        select(Role).where(
            Role.name == "owner",
            Role.scope == "org",
            Role.is_sys.is_(True),
            Role.org_id.is_(None),
        )
    )
    if owner_role and membership.role_id == owner_role.id:
        active_owners_count = await session.scalar(
            select(func.count(Membership.id)).where(
                Membership.org_id == org_id,
                Membership.role_id == owner_role.id,
                Membership.status == "active",
            )
        )
        if active_owners_count is not None and active_owners_count <= 1:
            raise APIException(
                status_code=status.HTTP_409_CONFLICT,
                code="LAST_OWNER",
                message="Cannot leave organization as the last owner.",
            )

    # Clear lead_member_id from any teams led by this member in this org
    await session.execute(
        update(Team)
        .where(Team.org_id == org_id, Team.lead_member_id == membership.id)
        .values(lead_member_id=None)
    )

    # Deleting membership cascades to team_members and plans
    await session.delete(membership)
    await session.flush()
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 8. Transfer ownership — requires "org.transfer" (org scope)
# ---------------------------------------------------------------------------

@router.post(
    "/orgs/{org_id}/transfer-ownership",
    dependencies=[Depends(RequirePermission("org.transfer", allowed_scopes="org"))],
)
async def transfer_ownership(
    org_id: UUID,
    body: TransferOwnershipRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> MemberOut:
    """Transfer organization ownership to another member.

    Target must be an active member of the same org. The old owner becomes admin.
    """
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.org_id == org_id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBERSHIP_NOT_FOUND",
            message="Caller membership not found.",
        )

    target_membership = await session.scalar(
        select(Membership).where(
            Membership.id == body.new_owner_member_id,
            Membership.org_id == org_id,
        )
    )
    if not target_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBER_NOT_FOUND",
            message="Target member not found in this organization.",
        )

    if target_membership.status != "active":
        raise APIException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INACTIVE_MEMBER",
            message="Target member is not active.",
        )

    if target_membership.id == caller_membership.id:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="ALREADY_OWNER",
            message="Cannot transfer ownership to yourself.",
        )

    owner_role = await session.scalar(
        select(Role).where(
            Role.name == "owner",
            Role.scope == "org",
            Role.is_sys.is_(True),
            Role.org_id.is_(None),
        )
    )
    admin_role = await session.scalar(
        select(Role).where(
            Role.name == "admin",
            Role.scope == "org",
            Role.is_sys.is_(True),
            Role.org_id.is_(None),
        )
    )
    if not owner_role or not admin_role:
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="ROLE_NOT_FOUND",
            message="System roles owner or admin not configured.",
        )

    # Swap roles: caller becomes admin, target becomes owner
    caller_membership.role_id = admin_role.id
    target_membership.role_id = owner_role.id

    await session.flush()
    await session.commit()
    await session.refresh(target_membership)

    target_user = await session.get(User, target_membership.user_id)
    if not target_user:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="USER_NOT_FOUND",
            message="Target user not found.",
        )

    return MemberOut(
        membership_id=target_membership.id,
        user_id=target_user.id,
        email=target_user.email,
        first_name=target_user.first_name,
        last_name=target_user.last_name,
        role="owner",
        status=target_membership.status,
        joined_at=target_membership.created_at,
    )


# ---------------------------------------------------------------------------
# 9. Delete organization — requires "org.delete" (org scope)
# ---------------------------------------------------------------------------

@router.delete(
    "/orgs/{org_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(RequirePermission("org.delete", allowed_scopes="org"))],
)
async def delete_org(
    org_id: UUID,
    body: DeleteOrgRequest,
    session: DBSession,
) -> Response:
    """Delete organization permanently if confirm_name matches.

    Access: requires ``org.delete`` permission in org scope.
    """
    org = await session.get(Organization, org_id)
    if not org:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ORG_NOT_FOUND",
            message="Organization not found.",
        )

    if body.confirm_name != org.name:
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="CONFIRMATION_MISMATCH",
            message="Organization name confirmation does not match.",
        )

    await session.delete(org)
    await session.flush()
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 10. List organization members — requires "member.manage" (org scope)
# ---------------------------------------------------------------------------

@router.get(
    "/orgs/{org_id}/members",
    dependencies=[Depends(RequirePermission("member.manage", allowed_scopes="org"))],
)
async def list_org_members(
    org_id: UUID,
    session: DBSession,
    q: str | None = None,
    role: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PaginatedResponse[MemberOut]:
    """List members of an organization with search, role filter, and pagination.

    Access: requires ``member.manage`` permission in org scope.
    """
    query = (
        select(Membership, User, Role)
        .join(User, User.id == Membership.user_id)
        .join(Role, Role.id == Membership.role_id)
        .where(
            Membership.org_id == org_id,
            Membership.status != "removed",
        )
    )

    if q:
        search_pattern = f"%{q}%"
        query = query.where(
            or_(
                User.email.ilike(search_pattern),
                User.first_name.ilike(search_pattern),
                User.last_name.ilike(search_pattern),
            )
        )

    if role:
        query = query.where(Role.name == role)

    # Count total matching rows
    count_query = select(func.count()).select_from(query.subquery())
    total = (await session.scalar(count_query)) or 0

    # Paginate
    offset = (page - 1) * page_size
    paged_query = query.order_by(Membership.created_at.asc()).offset(offset).limit(page_size)
    rows = await session.execute(paged_query)

    items: list[MemberOut] = []
    for membership, user, member_role in rows:
        items.append(
            MemberOut(
                membership_id=membership.id,
                user_id=user.id,
                email=user.email,
                first_name=user.first_name,
                last_name=user.last_name,
                role=member_role.name,
                status=membership.status,
                joined_at=membership.created_at,
            )
        )

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------
# 11. Update member role — requires "org.role.assign" (org scope)
# ---------------------------------------------------------------------------

@router.patch(
    "/orgs/{org_id}/members/{member_id}/role",
    dependencies=[Depends(RequirePermission("org.role.assign", allowed_scopes="org"))],
)
async def update_member_role(
    org_id: UUID,
    member_id: UUID,
    body: UpdateMemberRoleRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> MemberOut:
    """Update a member's role (admin / member).

    Access: requires ``org.role.assign`` permission in org scope.
    Rules:
    - cannot target the owner (use transfer ownership instead)
    - cannot change your own role
    - target role must be 'admin' or 'member'
    """
    target_membership = await session.scalar(
        select(Membership).where(
            Membership.id == member_id,
            Membership.org_id == org_id,
        )
    )
    if not target_membership or target_membership.status == "removed":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBER_NOT_FOUND",
            message="Member not found in this organization.",
        )

    if target_membership.user_id == current_user.id:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="CANNOT_CHANGE_OWN_ROLE",
            message="Cannot change your own role.",
        )

    owner_role = await session.scalar(
        select(Role).where(
            Role.name == "owner",
            Role.scope == "org",
            Role.is_sys.is_(True),
            Role.org_id.is_(None),
        )
    )
    if owner_role and target_membership.role_id == owner_role.id:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="CANNOT_TARGET_OWNER",
            message="Cannot change the role of the owner. Use transfer ownership instead.",
        )

    # Determine desired role
    target_role: Role | None = None
    if body.role_id:
        target_role = await session.scalar(
            select(Role).where(
                Role.id == body.role_id,
                Role.scope == "org",
            )
        )
        if not target_role or target_role.name not in ("admin", "member"):
            raise APIException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="INVALID_ROLE",
                message="Role must be admin or member.",
            )
    elif body.role_name:
        if body.role_name not in ("admin", "member"):
            raise APIException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="INVALID_ROLE",
                message="Role must be admin or member.",
            )
        target_role = await session.scalar(
            select(Role).where(
                Role.name == body.role_name,
                Role.scope == "org",
                Role.is_sys.is_(True),
                Role.org_id.is_(None),
            )
        )
    else:
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="MISSING_ROLE",
            message="Must provide roleID or role_name.",
        )

    if not target_role:
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="ROLE_NOT_FOUND",
            message="Target role not found.",
        )

    target_membership.role_id = target_role.id
    await session.flush()
    await session.commit()
    await session.refresh(target_membership)

    user = await session.get(User, target_membership.user_id)
    if not user:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="USER_NOT_FOUND",
            message="User not found.",
        )

    return MemberOut(
        membership_id=target_membership.id,
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=target_role.name,
        status=target_membership.status,
        joined_at=target_membership.created_at,
    )


# ---------------------------------------------------------------------------
# 12. Remove member — requires "member.manage" (org scope)
# ---------------------------------------------------------------------------

@router.delete(
    "/orgs/{org_id}/members/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(RequirePermission("member.manage", allowed_scopes="org"))],
)
async def remove_org_member(
    org_id: UUID,
    member_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> Response:
    """Remove a member from the organization by setting their status to 'removed'.

    Access: requires ``member.manage`` permission in org scope.
    Rules:
    - An admin can remove only member roles.
    - Only an owner can remove an admin.
    - Nobody can remove the owner.
    - Use leave to remove yourself.
    - If the target leads a team, clear team.lead_member_id.
    - Remove target's team_members rows.
    - Do not remove the row; change status to 'removed'.
    """
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.org_id == org_id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBERSHIP_NOT_FOUND",
            message="Caller membership not found.",
        )

    caller_role = await session.get(Role, caller_membership.role_id)
    if not caller_role:
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="ROLE_NOT_FOUND",
            message="Caller role not found.",
        )

    target_membership = await session.scalar(
        select(Membership).where(
            Membership.id == member_id,
            Membership.org_id == org_id,
        )
    )
    if not target_membership or target_membership.status == "removed":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBER_NOT_FOUND",
            message="Member not found in this organization.",
        )

    # Use leave to remove yourself
    if target_membership.user_id == current_user.id:
        raise APIException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="USE_LEAVE_TO_REMOVE_SELF",
            message="Use leave to remove yourself from the organization.",
        )

    target_role = await session.get(Role, target_membership.role_id)
    if not target_role:
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="ROLE_NOT_FOUND",
            message="Target role not found.",
        )

    # Nobody can remove the owner
    if target_role.name == "owner":
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="CANNOT_REMOVE_OWNER",
            message="Nobody can remove the organization owner.",
        )

    # An admin can remove only member roles. Only an owner can remove an admin.
    if caller_role.name == "admin" and target_role.name != "member":
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ADMIN_CANNOT_REMOVE_ADMIN",
            message="Admins can only remove members. Only an owner can remove an admin.",
        )

    # If the target leads a team, clear team.lead_member_id
    await session.execute(
        update(Team)
        .where(Team.org_id == org_id, Team.lead_member_id == target_membership.id)
        .values(lead_member_id=None)
    )

    # Remove target's team_members rows in this org
    await session.execute(
        delete(TeamMember).where(TeamMember.member_id == target_membership.id)
    )

    # Do not remove the membership row; change status to 'removed'
    target_membership.status = "removed"
    await session.flush()
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 13. Update member status — requires "member.manage" (org scope)
# ---------------------------------------------------------------------------

@router.patch(
    "/orgs/{org_id}/members/{member_id}/status",
    dependencies=[Depends(RequirePermission("member.manage", allowed_scopes="org"))],
)
async def update_member_status(
    org_id: UUID,
    member_id: UUID,
    body: UpdateMemberStatusRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> MemberOut:
    """Update a member's status (active / suspended).

    Access: requires ``member.manage`` permission in org scope.
    Rules:
    - cannot suspend or change status of yourself
    - cannot suspend the owner
    - admin can only manage member roles
    - a suspended membership is blocked by the org dependency
    """
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.org_id == org_id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBERSHIP_NOT_FOUND",
            message="Caller membership not found.",
        )

    caller_role = await session.get(Role, caller_membership.role_id)
    if not caller_role:
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="ROLE_NOT_FOUND",
            message="Caller role not found.",
        )

    target_membership = await session.scalar(
        select(Membership).where(
            Membership.id == member_id,
            Membership.org_id == org_id,
        )
    )
    if not target_membership or target_membership.status == "removed":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBER_NOT_FOUND",
            message="Member not found in this organization.",
        )

    if target_membership.user_id == current_user.id:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="CANNOT_CHANGE_OWN_STATUS",
            message="Cannot change your own membership status.",
        )

    target_role = await session.get(Role, target_membership.role_id)
    if not target_role:
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="ROLE_NOT_FOUND",
            message="Target role not found.",
        )

    if target_role.name == "owner":
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="CANNOT_SUSPEND_OWNER",
            message="Cannot suspend the organization owner.",
        )

    if caller_role.name == "admin" and target_role.name != "member":
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ADMIN_CANNOT_MANAGE_ADMIN",
            message="Admins can only manage members. Only an owner can manage an admin.",
        )

    target_membership.status = body.status
    await session.flush()
    await session.commit()
    await session.refresh(target_membership)

    user = await session.get(User, target_membership.user_id)
    if not user:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="USER_NOT_FOUND",
            message="User not found.",
        )

    return MemberOut(
        membership_id=target_membership.id,
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=target_role.name,
        status=target_membership.status,
        joined_at=target_membership.created_at,
    )


# ---------------------------------------------------------------------------
# 14. Create team — requires "team.manage" (org scope)
# ---------------------------------------------------------------------------

@router.post(
    "/orgs/{org_id}/teams",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RequirePermission("team.manage", allowed_scopes="org"))],
)
async def create_team(
    org_id: UUID,
    body: CreateTeamRequest,
    session: DBSession,
) -> TeamOut:
    """Create a new team in the organization.

    Access: requires ``team.manage`` permission in org scope.
    Note: if lead_member_id is given, it must be an active member of the org.
    Creates their team_members row with the team_lead role.
    """
    lead_mem: Membership | None = None
    if body.lead_member_id:
        lead_mem = await session.scalar(
            select(Membership).where(
                Membership.id == body.lead_member_id,
                Membership.org_id == org_id,
            )
        )
        if not lead_mem:
            raise APIException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="MEMBER_NOT_FOUND",
                message="Lead member not found in this organization.",
            )
        if lead_mem.status != "active":
            raise APIException(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INACTIVE_MEMBER",
                message="Lead member must be active.",
            )

    team = Team(
        org_id=org_id,
        name=body.name,
        lead_member_id=lead_mem.id if lead_mem else None,
    )
    session.add(team)
    await session.flush()

    lead_info: TeamLeadInfo | None = None
    if lead_mem:
        team_lead_role = await session.scalar(
            select(Role).where(
                Role.name == "team_lead",
                Role.scope == "team",
                Role.is_sys.is_(True),
                Role.org_id.is_(None),
            )
        )
        if not team_lead_role:
            raise APIException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                code="ROLE_NOT_FOUND",
                message="System team_lead role not found.",
            )
        tm = TeamMember(
            team_id=team.id,
            member_id=lead_mem.id,
            org_id=org_id,
            role_id=team_lead_role.id,
            membership_status="active",
        )
        session.add(tm)
        await session.flush()

        lead_user = await session.get(User, lead_mem.user_id)
        if lead_user:
            lead_info = TeamLeadInfo(
                membership_id=lead_mem.id,
                first_name=lead_user.first_name,
                last_name=lead_user.last_name,
            )

    await session.commit()
    await session.refresh(team)

    return TeamOut(
        id=team.id,
        name=team.name,
        lead=lead_info,
        member_count=1 if lead_mem else 0,
    )


# ---------------------------------------------------------------------------
# 15. Get caller's teams — requires "org.view" (org scope)
# ---------------------------------------------------------------------------

@router.get(
    "/orgs/{org_id}/my-teams",
    dependencies=[Depends(RequirePermission("org.view", allowed_scopes="org"))],
)
async def get_my_teams(
    org_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> list[MyTeamResponse]:
    """List teams that the caller belongs to within the organization.

    Access: requires ``org.view`` in org scope.
    Rules:
    - when a suspended user tries to get the team, return the team but don't let the user enter (can_enter=False).
    - if status is removed, do not show the team.
    - validate whether user is suspended before releasing data at route level.
    """
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.org_id == org_id,
        )
    )
    if not membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message="Membership not found in this organization.",
        )

    rows = (await session.execute(
        select(TeamMember, Team, Role)
        .join(Team, Team.id == TeamMember.team_id)
        .join(Role, Role.id == TeamMember.role_id)
        .where(
            TeamMember.member_id == membership.id,
            TeamMember.org_id == org_id,
            TeamMember.membership_status != "removed",
        )
        .order_by(Team.name.asc())
    )).all()

    role_ids = list({role.id for _, _, role in rows})
    role_perms_map: dict[UUID, list[str]] = {rid: [] for rid in role_ids}
    if role_ids:
        perm_rows = (
            await session.execute(
                select(RolePermission.role_id, Permission.permission_code)
                .join(Permission, Permission.id == RolePermission.permission_id)
                .where(RolePermission.role_id.in_(role_ids))
            )
        ).all()
        for rid, pcode in perm_rows:
            role_perms_map[rid].append(pcode)

    result: list[MyTeamResponse] = []
    for tm, team, role in rows:
        # Determine can_enter
        is_suspended = (tm.membership_status == "suspended") or (membership.status == "suspended")
        can_enter = not is_suspended

        # Lead info
        lead_info: TeamLeadInfo | None = None
        if team.lead_member_id:
            lead_row = await session.execute(
                select(Membership, User)
                .join(User, User.id == Membership.user_id)
                .where(Membership.id == team.lead_member_id)
            )
            data = lead_row.first()
            if data:
                l_mem, l_user = data
                lead_info = TeamLeadInfo(
                    membership_id=l_mem.id,
                    first_name=l_user.first_name,
                    last_name=l_user.last_name,
                )

        cnt = await session.scalar(
            select(func.count(TeamMember.id)).where(
                TeamMember.team_id == team.id,
                TeamMember.membership_status != "removed",
            )
        ) or 0

        team_out = TeamOut(
            id=team.id,
            name=team.name,
            lead=lead_info,
            member_count=cnt,
        )

        result.append(
            MyTeamResponse(
                team=team_out,
                my_team_role=role.name,
                membership_status=tm.membership_status,
                can_enter=can_enter,
                permissions=sorted(role_perms_map.get(role.id, [])),
            )
        )

    return result


# ---------------------------------------------------------------------------
# 16. Get team detail — requires team.view (team scope) or team.manage (org scope)
# ---------------------------------------------------------------------------

@router.get(
    "/orgs/{org_id}/teams/{team_id}",
    dependencies=[Depends(RequireTeamViewOrOrgManage())],
)
async def get_team_detail(
    org_id: UUID,
    team_id: UUID,
    session: DBSession,
) -> TeamDetailResponse:
    """Get team details and members.

    Access: requires ``team.view`` on team or ``team.manage`` on org.
    Notes:
    - return data according to membership_status in the team.
    - if status is removed, do not show those members.
    - if suspended, return but explicitly display suspended.
    """
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found in this organization.",
        )

    lead_info: TeamLeadInfo | None = None
    if team.lead_member_id:
        lead_row = await session.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(Membership.id == team.lead_member_id)
        )
        data = lead_row.first()
        if data:
            l_mem, l_user = data
            lead_info = TeamLeadInfo(
                membership_id=l_mem.id,
                first_name=l_user.first_name,
                last_name=l_user.last_name,
            )

    members_query = await session.execute(
        select(TeamMember, Membership, User, Role)
        .join(Membership, Membership.id == TeamMember.member_id)
        .join(User, User.id == Membership.user_id)
        .join(Role, Role.id == TeamMember.role_id)
        .where(
            TeamMember.team_id == team_id,
            TeamMember.membership_status != "removed",
        )
        .order_by(TeamMember.created_at.asc())
    )

    members_list: list[TeamMemberOut] = []
    for tm, mem, u, r in members_query:
        members_list.append(
            TeamMemberOut(
                membership_id=mem.id,
                first_name=u.first_name,
                last_name=u.last_name,
                email=u.email,
                team_role=r.name,
                membership_status=tm.membership_status,
            )
        )

    return TeamDetailResponse(
        id=team.id,
        name=team.name,
        lead=lead_info,
        member_count=len(members_list),
        members=members_list,
    )


# ---------------------------------------------------------------------------
# 17. Update team name — requires "team.manage" (org scope)
# ---------------------------------------------------------------------------

@router.patch(
    "/orgs/{org_id}/teams/{team_id}",
    dependencies=[Depends(RequirePermission("team.manage", allowed_scopes="org"))],
)
async def update_team(
    org_id: UUID,
    team_id: UUID,
    body: UpdateTeamRequest,
    session: DBSession,
) -> TeamOut:
    """Update team name.

    Access: requires ``team.manage`` permission in org scope.
    """
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found in this organization.",
        )

    team.name = body.name
    await session.flush()
    await session.commit()
    await session.refresh(team)

    lead_info: TeamLeadInfo | None = None
    if team.lead_member_id:
        lead_row = await session.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(Membership.id == team.lead_member_id)
        )
        data = lead_row.first()
        if data:
            l_mem, l_user = data
            lead_info = TeamLeadInfo(
                membership_id=l_mem.id,
                first_name=l_user.first_name,
                last_name=l_user.last_name,
            )

    cnt = await session.scalar(
        select(func.count(TeamMember.id)).where(
            TeamMember.team_id == team.id,
            TeamMember.membership_status != "removed",
        )
    ) or 0

    return TeamOut(
        id=team.id,
        name=team.name,
        lead=lead_info,
        member_count=cnt,
    )


# ---------------------------------------------------------------------------
# 18. Delete team — requires "team.manage" (org scope)
# ---------------------------------------------------------------------------

@router.delete(
    "/orgs/{org_id}/teams/{team_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(RequirePermission("team.manage", allowed_scopes="org"))],
)
async def delete_team(
    org_id: UUID,
    team_id: UUID,
    session: DBSession,
) -> Response:
    """Delete a team, removing its plans, tasks, and team members.

    Access: requires ``team.manage`` in org scope.
    """
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found in this organization.",
        )

    # Remove plans and plan tasks for this team
    plans = (await session.scalars(select(Plan).where(Plan.team_id == team_id))).all()
    for p in plans:
        await session.execute(delete(PlanTask).where(PlanTask.plan_id == p.id))
        await session.delete(p)

    # Remove all members of that team by team ID
    await session.execute(delete(TeamMember).where(TeamMember.team_id == team_id))

    # Delete team
    await session.delete(team)
    await session.flush()
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 19. List team members — requires team.view (team scope) or team.manage (org scope)
# ---------------------------------------------------------------------------

@router.get(
    "/orgs/{org_id}/teams/{team_id}/members",
    dependencies=[Depends(RequireTeamViewOrOrgManage())],
)
async def list_team_members(
    org_id: UUID,
    team_id: UUID,
    session: DBSession,
) -> list[TeamMemberOut]:
    """List members of a team.

    Access: requires ``team.view`` on team or ``team.manage`` on org.
    Notes:
    - return data according to membership_status in the team.
    - if status is removed, do not show those members.
    - if suspended, return but explicitly display suspended.
    """
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found in this organization.",
        )

    members_query = await session.execute(
        select(TeamMember, Membership, User, Role)
        .join(Membership, Membership.id == TeamMember.member_id)
        .join(User, User.id == Membership.user_id)
        .join(Role, Role.id == TeamMember.role_id)
        .where(
            TeamMember.team_id == team_id,
            TeamMember.membership_status != "removed",
        )
        .order_by(TeamMember.created_at.asc())
    )

    result: list[TeamMemberOut] = []
    for tm, mem, u, r in members_query:
        result.append(
            TeamMemberOut(
                membership_id=mem.id,
                first_name=u.first_name,
                last_name=u.last_name,
                email=u.email,
                team_role=r.name,
                membership_status=tm.membership_status,
            )
        )
    return result


# ---------------------------------------------------------------------------
# 20. Add team member — requires "team.manage" (org scope)
# ---------------------------------------------------------------------------

@router.post(
    "/orgs/{org_id}/teams/{team_id}/members",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RequirePermission("team.manage", allowed_scopes="org"))],
)
async def add_team_member(
    org_id: UUID,
    team_id: UUID,
    body: AddTeamMemberRequest,
    session: DBSession,
) -> TeamMemberOut:
    """Add a member to a team.

    Access: requires ``team.manage`` in org scope.
    Notes:
    - member must be active in the same org.
    - new rows get the team_member role.
    - return 409 if already in the team.
    """
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found in this organization.",
        )

    target_mem = await session.scalar(
        select(Membership).where(
            Membership.id == body.member_id,
            Membership.org_id == org_id,
        )
    )
    if not target_mem or target_mem.status == "removed":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBER_NOT_FOUND",
            message="Member not found in this organization.",
        )
    if target_mem.status != "active":
        raise APIException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INACTIVE_MEMBER",
            message="Member must be active in the organization.",
        )

    existing_tm = await session.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.member_id == body.member_id,
        )
    )
    if existing_tm and existing_tm.membership_status != "removed":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="ALREADY_IN_TEAM",
            message="Member is already in the team.",
        )

    team_member_role = await session.scalar(
        select(Role).where(
            Role.name == "team_member",
            Role.scope == "team",
            Role.is_sys.is_(True),
            Role.org_id.is_(None),
        )
    )
    if not team_member_role:
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="ROLE_NOT_FOUND",
            message="System team_member role not configured.",
        )

    if existing_tm and existing_tm.membership_status == "removed":
        existing_tm.membership_status = "active"
        existing_tm.role_id = team_member_role.id
        tm = existing_tm
    else:
        tm = TeamMember(
            team_id=team_id,
            member_id=target_mem.id,
            org_id=org_id,
            role_id=team_member_role.id,
            membership_status="active",
        )
        session.add(tm)

    await session.flush()
    await session.commit()
    await session.refresh(tm)

    user = await session.get(User, target_mem.user_id)
    if not user:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="USER_NOT_FOUND",
            message="User not found.",
        )

    return TeamMemberOut(
        membership_id=target_mem.id,
        first_name=user.first_name,
        last_name=user.last_name,
        email=user.email,
        team_role=team_member_role.name,
        membership_status=tm.membership_status,
    )


# ---------------------------------------------------------------------------
# 21. Remove team member — requires "team.manage" (org scope)
# ---------------------------------------------------------------------------

@router.delete(
    "/orgs/{org_id}/teams/{team_id}/members/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(RequirePermission("team.manage", allowed_scopes="org"))],
)
async def remove_team_member(
    org_id: UUID,
    team_id: UUID,
    member_id: UUID,
    session: DBSession,
) -> Response:
    """Remove a member from a team by setting membership_status to 'removed'.

    Access: requires ``team.manage`` in org scope.
    Notes:
    - sets membership_status to 'removed'.
    - if removed member is the lead, clear team.lead_member_id.
    """
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found in this organization.",
        )

    tm = await session.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            or_(
                TeamMember.member_id == member_id,
                TeamMember.id == member_id,
            ),
        )
    )
    if not tm or tm.membership_status == "removed":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBER_NOT_FOUND",
            message="Team member not found in this team.",
        )

    tm.membership_status = "removed"
    if team.lead_member_id == tm.member_id:
        team.lead_member_id = None

    await session.flush()
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 22. Update team member status — requires "team.manage" (org scope)
# ---------------------------------------------------------------------------

@router.patch(
    "/orgs/{org_id}/teams/{team_id}/members/{member_id}",
    dependencies=[Depends(RequirePermission("team.manage", allowed_scopes="org"))],
)
async def update_team_member_status(
    org_id: UUID,
    team_id: UUID,
    member_id: UUID,
    body: UpdateTeamMemberStatusRequest,
    session: DBSession,
) -> TeamMemberOut:
    """Update team member status ('active' or 'suspended').

    Access: requires ``team.manage`` in org scope.
    """
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found in this organization.",
        )

    tm = await session.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            or_(
                TeamMember.member_id == member_id,
                TeamMember.id == member_id,
            ),
        )
    )
    if not tm or tm.membership_status == "removed":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBER_NOT_FOUND",
            message="Team member not found in this team.",
        )

    tm.membership_status = body.status
    await session.flush()
    await session.commit()
    await session.refresh(tm)

    mem = await session.get(Membership, tm.member_id)
    user = await session.get(User, mem.user_id) if mem else None
    role = await session.get(Role, tm.role_id)

    return TeamMemberOut(
        membership_id=tm.member_id,
        first_name=user.first_name if user else None,
        last_name=user.last_name if user else None,
        email=user.email if user else "",
        team_role=role.name if role else "",
        membership_status=tm.membership_status,
    )


# ---------------------------------------------------------------------------
# 23. Assign team lead — requires "team.lead.assign" (org scope)
# ---------------------------------------------------------------------------

@router.put(
    "/orgs/{org_id}/teams/{team_id}/lead",
    dependencies=[Depends(RequirePermission("team.lead.assign", allowed_scopes="org"))],
)
async def assign_team_lead(
    org_id: UUID,
    team_id: UUID,
    body: AssignTeamLeadRequest,
    session: DBSession,
) -> TeamOut:
    """Assign a team lead.

    Access: requires ``team.lead.assign`` in org scope.
    Notes:
    - the new lead must already be in the team, otherwise 409.
    - in one transaction: old lead's team_members.role becomes team_member,
      new one becomes team_lead, and team.lead_member_id is updated.
    - check teamMembershipStatus ('active') and membershipStatus ('active') in membership table.
    """
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found in this organization.",
        )

    target_tm = await session.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            or_(
                TeamMember.id == body.member_id,
                TeamMember.member_id == body.member_id,
            ),
        )
    )
    if not target_tm or target_tm.membership_status == "removed":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="NOT_IN_TEAM",
            message="The new lead must already be in the team.",
        )

    if target_tm.membership_status != "active":
        raise APIException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INACTIVE_TEAM_MEMBER",
            message="Team member must be active in the team to become lead.",
        )

    target_mem = await session.scalar(
        select(Membership).where(
            Membership.id == target_tm.member_id,
            Membership.org_id == org_id,
        )
    )
    if not target_mem or target_mem.status != "active":
        raise APIException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INACTIVE_ORG_MEMBER",
            message="Member must be an active member of the organization.",
        )

    team_lead_role = await session.scalar(
        select(Role).where(
            Role.name == "team_lead",
            Role.scope == "team",
            Role.is_sys.is_(True),
            Role.org_id.is_(None),
        )
    )
    team_member_role = await session.scalar(
        select(Role).where(
            Role.name == "team_member",
            Role.scope == "team",
            Role.is_sys.is_(True),
            Role.org_id.is_(None),
        )
    )
    if not team_lead_role or not team_member_role:
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="ROLE_NOT_FOUND",
            message="System team roles not found.",
        )

    # Demote old lead if different
    if team.lead_member_id and team.lead_member_id != target_tm.member_id:
        old_lead_tm = await session.scalar(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.member_id == team.lead_member_id,
            )
        )
        if old_lead_tm:
            old_lead_tm.role_id = team_member_role.id

    # Promote new lead
    target_tm.role_id = team_lead_role.id
    team.lead_member_id = target_tm.member_id

    await session.flush()
    await session.commit()
    await session.refresh(team)

    lead_user = await session.get(User, target_mem.user_id)
    lead_info = TeamLeadInfo(
        membership_id=target_mem.id,
        first_name=lead_user.first_name if lead_user else None,
        last_name=lead_user.last_name if lead_user else None,
    )

    cnt = await session.scalar(
        select(func.count(TeamMember.id)).where(
            TeamMember.team_id == team.id,
            TeamMember.membership_status != "removed",
        )
    ) or 0

    return TeamOut(
        id=team.id,
        name=team.name,
        lead=lead_info,
        member_count=cnt,
    )


# ---------------------------------------------------------------------------
# 5. Plan routes (own plans) — requires "plan.manage_own" (scope: org)
# ---------------------------------------------------------------------------

def build_task_out(task: PlanTask) -> TaskOut:
    return TaskOut(
        id=task.id,
        task_type=task.task_type,
        title=task.title,
        description=task.description,
        why_it_matters=task.why_it_matters,
        status=task.status,
        order_index=task.order_index,
    )


def build_plan_out(plan: Plan, tasks: list[PlanTask]) -> PlanOut:
    return PlanOut(
        id=plan.id,
        team_id=plan.team_id,
        week_start_date=plan.week_start_date,
        status=plan.status,
        lead_comment=plan.lead_comment,
        returned_at=plan.returned_at,
        submitted_at=plan.submitted_at,
        approved_at=plan.approved_at,
        approved_by=plan.approved_by_member_id,
        main_shipped=plan.main_shipped,
        completed_at=plan.completed_at,
        tasks=[build_task_out(t) for t in sorted(tasks, key=lambda x: x.order_index)],
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


@router.get(
    "/orgs/{org_id}/plans",
    response_model=PaginatedResponse[PlanSummary],
    dependencies=[Depends(RequirePermission("plan.manage_own"))],
)
async def list_plans(
    org_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
    week_start_date: datetime.date | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PaginatedResponse[PlanSummary]:
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBERSHIP_NOT_FOUND",
            message="Active membership not found",
        )

    query_conditions = [
        Plan.org_id == org_id,
        Plan.member_id == caller_membership.id,
    ]
    if week_start_date is not None:
        query_conditions.append(Plan.week_start_date == week_start_date)
    if status_filter is not None:
        query_conditions.append(Plan.status == status_filter)

    total_query = select(func.count(Plan.id)).where(*query_conditions)
    total = (await session.scalar(total_query)) or 0

    plans_query = (
        select(
            Plan.id,
            Plan.team_id,
            Plan.week_start_date,
            Plan.status,
            Plan.main_shipped,
            func.count(PlanTask.id).label("task_count"),
            func.count(case((PlanTask.status == "done", PlanTask.id))).label("done_count"),
        )
        .outerjoin(PlanTask, PlanTask.plan_id == Plan.id)
        .where(*query_conditions)
        .group_by(Plan.id, Plan.team_id, Plan.week_start_date, Plan.status, Plan.main_shipped, Plan.created_at)
        .order_by(Plan.week_start_date.desc(), Plan.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await session.execute(plans_query)).all()
    items = [
        PlanSummary(
            id=r.id,
            team_id=r.team_id,
            week_start_date=r.week_start_date,
            status=r.status,
            task_count=r.task_count,
            done_count=r.done_count,
            main_shipped=r.main_shipped,
        )
        for r in rows
    ]
    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/orgs/{org_id}/plans",
    response_model=PlanOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RequirePermission("plan.manage_own"))],
)
async def create_plan(
    org_id: UUID,
    payload: CreatePlanRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> PlanOut:
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="MEMBERSHIP_NOT_FOUND",
            message="Active membership not found",
        )

    # week_start_date must be a Monday (weekday() == 0)
    if payload.week_start_date.weekday() != 0:
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="INVALID_WEEK_START",
            message="week_start_date must be a Monday",
        )

    # team_id must be a team in this org that the caller belongs to
    team = await session.scalar(
        select(Team).where(Team.id == payload.team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found in this organization",
        )

    caller_team_member = await session.scalar(
        select(TeamMember).where(
            TeamMember.team_id == payload.team_id,
            TeamMember.member_id == caller_membership.id,
            TeamMember.membership_status == "active",
        )
    )
    if not caller_team_member:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="NOT_TEAM_MEMBER",
            message="Caller is not an active member of this team",
        )

    team_perms = await get_permissions_for_roles(session, [caller_team_member.role_id])
    if "plan.create" not in team_perms or team.lead_member_id == caller_membership.id:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="PERMISSION_DENIED",
            message="Team leads cannot create plans for teams they lead. Missing team permission: plan.create",
        )

    # Unique (member_id, org_id, week_start_date). On a duplicate, return 409 with the existing plan id
    existing_plan = await session.scalar(
        select(Plan).where(
            Plan.org_id == org_id,
            Plan.member_id == caller_membership.id,
            Plan.week_start_date == payload.week_start_date,
        )
    )
    if existing_plan:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="PLAN_ALREADY_EXISTS",
            message="A plan already exists for this week",
            extra={"existing_plan_id": str(existing_plan.id)},
        )

    # A draft may be incomplete, but has at most one main task
    main_count = sum(1 for t in payload.tasks if t.task_type == "main")
    if main_count > 1:
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="MULTIPLE_MAIN_TASKS",
            message="A plan can have at most one main task",
        )

    plan = Plan(
        org_id=org_id,
        member_id=caller_membership.id,
        team_id=payload.team_id,
        week_start_date=payload.week_start_date,
        status="draft",
    )
    session.add(plan)
    await session.flush()

    created_tasks: list[PlanTask] = []
    for t in payload.tasks:
        task = PlanTask(
            plan_id=plan.id,
            task_type=t.task_type,
            title=t.title,
            description=t.description,
            why_it_matters=t.why_it_matters,
            status="pending",
            order_index=t.order_index,
        )
        session.add(task)
        created_tasks.append(task)

    await session.commit()
    return build_plan_out(plan, created_tasks)


@router.get(
    "/orgs/{org_id}/plans/{plan_id}",
    response_model=PlanOut,
    dependencies=[Depends(RequirePermission("plan.manage_own"))],
)
async def get_plan(
    org_id: UUID,
    plan_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> PlanOut:
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.org_id == org_id,
            Plan.member_id == caller_membership.id,
        )
    )
    if not plan:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    tasks = (
        await session.scalars(
            select(PlanTask).where(PlanTask.plan_id == plan.id).order_by(PlanTask.order_index)
        )
    ).all()
    return build_plan_out(plan, list(tasks))


@router.put(
    "/orgs/{org_id}/plans/{plan_id}",
    response_model=PlanOut,
    dependencies=[Depends(RequirePermission("plan.manage_own"))],
)
async def update_plan(
    org_id: UUID,
    plan_id: UUID,
    payload: UpdatePlanRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> PlanOut:
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.org_id == org_id,
            Plan.member_id == caller_membership.id,
        )
    )
    if not plan:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    # Only in draft, otherwise 409
    if plan.status != "draft":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="PLAN_NOT_DRAFT",
            message="Only draft plans can be modified",
        )

    if payload.team_id is not None and payload.team_id != plan.team_id:
        team = await session.scalar(
            select(Team).where(Team.id == payload.team_id, Team.org_id == org_id)
        )
        if not team:
            raise APIException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="TEAM_NOT_FOUND",
                message="Team not found in this organization",
            )
        caller_team_member = await session.scalar(
            select(TeamMember).where(
                TeamMember.team_id == payload.team_id,
                TeamMember.member_id == caller_membership.id,
                TeamMember.membership_status == "active",
            )
        )
        if not caller_team_member:
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="NOT_TEAM_MEMBER",
                message="Caller is not an active member of this team",
            )
        team_perms = await get_permissions_for_roles(session, [caller_team_member.role_id])
        if "plan.create" not in team_perms or team.lead_member_id == caller_membership.id:
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="PERMISSION_DENIED",
                message="Team leads cannot create plans for teams they lead. Missing team permission: plan.create",
            )
        plan.team_id = payload.team_id

    # At most one main task
    main_count = sum(1 for t in payload.tasks if t.task_type == "main")
    if main_count > 1:
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="MULTIPLE_MAIN_TASKS",
            message="A plan can have at most one main task",
        )

    current_tasks = (
        await session.scalars(select(PlanTask).where(PlanTask.plan_id == plan.id))
    ).all()
    current_by_id = {t.id: t for t in current_tasks}

    incoming_ids = {t.id for t in payload.tasks if t.id is not None}
    for incoming_id in incoming_ids:
        if incoming_id not in current_by_id:
            raise APIException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="TASK_NOT_FOUND",
                message=f"Task {incoming_id} does not belong to this plan",
            )

    # 1. Delete missing tasks
    for existing_id, existing_task in current_by_id.items():
        if existing_id not in incoming_ids:
            await session.delete(existing_task)
    await session.flush()

    # 2. Update existing non-main tasks first, then main tasks (to respect partial unique index)
    for t in [t for t in payload.tasks if t.id is not None and t.task_type != "main"]:
        task_obj = current_by_id[t.id]
        task_obj.task_type = t.task_type
        task_obj.title = t.title
        task_obj.description = t.description
        task_obj.why_it_matters = t.why_it_matters
        task_obj.order_index = t.order_index
    await session.flush()

    for t in [t for t in payload.tasks if t.id is not None and t.task_type == "main"]:
        task_obj = current_by_id[t.id]
        task_obj.task_type = t.task_type
        task_obj.title = t.title
        task_obj.description = t.description
        task_obj.why_it_matters = t.why_it_matters
        task_obj.order_index = t.order_index
    await session.flush()

    # 3. Create new tasks
    for t in [t for t in payload.tasks if t.id is None]:
        new_task = PlanTask(
            plan_id=plan.id,
            task_type=t.task_type,
            title=t.title,
            description=t.description,
            why_it_matters=t.why_it_matters,
            status="pending",
            order_index=t.order_index,
        )
        session.add(new_task)

    await session.commit()
    refreshed_tasks = (
        await session.scalars(
            select(PlanTask).where(PlanTask.plan_id == plan.id).order_by(PlanTask.order_index)
        )
    ).all()
    return build_plan_out(plan, list(refreshed_tasks))


@router.delete(
    "/orgs/{org_id}/plans/{plan_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(RequirePermission("plan.manage_own"))],
)
async def delete_plan(
    org_id: UUID,
    plan_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
    new_plan_id_query: UUID | None = Query(None, alias="new_plan_ID_approving"),
    new_plan_id_query_alt: UUID | None = Query(None, alias="new_plan_id_approving"),
    payload: DeletePlanRequest | None = Body(None),
) -> Response:
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.org_id == org_id,
            Plan.member_id == caller_membership.id,
        )
    )
    if not plan:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    new_plan_approving_id = (
        (payload.new_plan_ID_approving if payload else None)
        or new_plan_id_query
        or new_plan_id_query_alt
    )

    if new_plan_approving_id is None:
        if plan.status != "draft":
            raise APIException(
                status_code=status.HTTP_409_CONFLICT,
                code="CANNOT_DELETE_NON_DRAFT",
                message="Only draft plans can be deleted directly",
            )
        await session.delete(plan)
        await session.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # When new_plan_ID_approving is provided, replacing an approved plan with a draft plan
    if plan.id == new_plan_approving_id:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="CANNOT_REPLACE_SELF",
            message="Cannot replace a plan with itself",
        )

    if plan.status != "approved":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="PLAN_NOT_APPROVED",
            message="Only approved plans can be replaced",
        )

    replacement_plan = await session.scalar(
        select(Plan).where(
            Plan.id == new_plan_approving_id,
            Plan.org_id == org_id,
            Plan.member_id == caller_membership.id,
        )
    )
    if not replacement_plan:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="REPLACEMENT_PLAN_NOT_FOUND",
            message="Replacement plan not found",
        )

    if replacement_plan.status != "draft":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="REPLACEMENT_NOT_DRAFT",
            message="Replacement plan must be in draft status",
        )

    target_week = plan.week_start_date
    await session.delete(plan)
    await session.flush()

    replacement_plan.week_start_date = target_week
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/orgs/{org_id}/plans/{plan_id}/tasks/{task_id}",
    response_model=TaskOut,
    dependencies=[Depends(RequirePermission("plan.manage_own"))],
)
async def update_task_status(
    org_id: UUID,
    plan_id: UUID,
    task_id: UUID,
    payload: UpdateTaskStatusRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> TaskOut:
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.org_id == org_id,
            Plan.member_id == caller_membership.id,
        )
    )
    if not plan:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    # Allowed only when the plan is approved
    if plan.status != "approved":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="PLAN_NOT_APPROVED",
            message="Task status can only be updated when the plan is approved",
        )

    task = await session.scalar(
        select(PlanTask).where(PlanTask.id == task_id, PlanTask.plan_id == plan.id)
    )
    if not task:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TASK_NOT_FOUND",
            message="Task not found",
        )

    task.status = payload.status
    await session.commit()
    return build_task_out(task)


@router.post(
    "/orgs/{org_id}/plans/{plan_id}/submit",
    response_model=PlanOut,
    dependencies=[Depends(RequirePermission("plan.manage_own"))],
)
async def submit_plan(
    org_id: UUID,
    plan_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> PlanOut:
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.org_id == org_id,
            Plan.member_id == caller_membership.id,
        )
    )
    if not plan:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    if plan.status != "draft":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="PLAN_NOT_DRAFT",
            message="Only draft plans can be submitted",
        )

    if not plan.team_id:
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="TEAM_REQUIRED",
            message="Plan must belong to a team before submitting",
        )

    caller_team_member = await session.scalar(
        select(TeamMember).where(
            TeamMember.team_id == plan.team_id,
            TeamMember.member_id == caller_membership.id,
            TeamMember.membership_status == "active",
        )
    )
    if not caller_team_member:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="NOT_TEAM_MEMBER",
            message="Author must be an active member of the plan's team",
        )

    tasks = (
        await session.scalars(
            select(PlanTask).where(PlanTask.plan_id == plan.id).order_by(PlanTask.order_index)
        )
    ).all()
    main_tasks = [t for t in tasks if t.task_type == "main"]
    if len(main_tasks) != 1:
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="INVALID_MAIN_TASK",
            message="A plan must have exactly one main task to submit",
        )

    main_task = main_tasks[0]
    if not main_task.why_it_matters or not main_task.why_it_matters.strip():
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="WHY_IT_MATTERS_REQUIRED",
            message="Main task must have a non-empty why_it_matters",
        )

    plan.status = "submitted"
    plan.submitted_at = datetime.datetime.now(datetime.timezone.utc)
    await session.commit()
    return build_plan_out(plan, list(tasks))


@router.post(
    "/orgs/{org_id}/plans/{plan_id}/complete",
    response_model=PlanOut,
    dependencies=[Depends(RequirePermission("plan.manage_own"))],
)
async def complete_plan(
    org_id: UUID,
    plan_id: UUID,
    payload: CompletePlanRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> PlanOut:
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.org_id == org_id,
            Plan.member_id == caller_membership.id,
        )
    )
    if not plan:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    if plan.status != "approved":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="PLAN_NOT_APPROVED",
            message="Only approved plans can be completed",
        )

    plan.status = "done"
    plan.main_shipped = payload.main_shipped
    plan.completed_at = datetime.datetime.now(datetime.timezone.utc)
    await session.commit()

    tasks = (
        await session.scalars(
            select(PlanTask).where(PlanTask.plan_id == plan.id).order_by(PlanTask.order_index)
        )
    ).all()
    return build_plan_out(plan, list(tasks))


@router.post(
    "/orgs/{org_id}/plans/{plan_id}/withdraw",
    response_model=PlanOut,
    dependencies=[Depends(RequirePermission("plan.manage_own"))],
)
async def withdraw_plan(
    org_id: UUID,
    plan_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> PlanOut:
    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.org_id == org_id,
            Plan.member_id == caller_membership.id,
        )
    )
    if not plan:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    if plan.status != "submitted":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="PLAN_NOT_SUBMITTED",
            message="Only submitted plans can be withdrawn",
        )

    plan.status = "draft"
    plan.submitted_at = None
    await session.commit()

    tasks = (
        await session.scalars(
            select(PlanTask).where(PlanTask.plan_id == plan.id).order_by(PlanTask.order_index)
        )
    ).all()
    return build_plan_out(plan, list(tasks))


# ===========================================================================
# Team Lead Plan Review & Oversight Routes (scope: team)
# ===========================================================================

@router.get(
    "/orgs/{org_id}/teams/{team_id}/plans",
    response_model=PaginatedResponse[TeamPlanSummaryOut],
    dependencies=[Depends(RequirePermission("plan.view_team", allowed_scopes="team"))],
)
async def list_team_plans(
    org_id: UUID,
    team_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
    week_start_date: datetime.date | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    member_id: UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PaginatedResponse[TeamPlanSummaryOut]:
    """List submitted/approved/done plans for a team. Drafts are never visible to team leads."""
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found",
        )

    # Drafts are never visible to the team lead
    query_conditions = [
        Plan.org_id == org_id,
        Plan.team_id == team_id,
        Plan.status != "draft",
    ]
    if status_filter:
        if status_filter == "draft":
            return PaginatedResponse(items=[], total=0, page=page, page_size=page_size)
        query_conditions.append(Plan.status == status_filter)
    if week_start_date:
        query_conditions.append(Plan.week_start_date == week_start_date)
    if member_id:
        query_conditions.append(Plan.member_id == member_id)

    total_query = select(func.count(Plan.id)).where(*query_conditions)
    total = (await session.scalar(total_query)) or 0

    plans_query = (
        select(
            Plan.id,
            Plan.team_id,
            Plan.week_start_date,
            Plan.status,
            Plan.main_shipped,
            Plan.member_id,
            User.first_name,
            User.last_name,
            func.count(PlanTask.id).label("task_count"),
            func.count(case((PlanTask.status == "done", PlanTask.id))).label("done_count"),
        )
        .join(Membership, Membership.id == Plan.member_id)
        .join(User, User.id == Membership.user_id)
        .outerjoin(PlanTask, PlanTask.plan_id == Plan.id)
        .where(*query_conditions)
        .group_by(
            Plan.id,
            Plan.team_id,
            Plan.week_start_date,
            Plan.status,
            Plan.main_shipped,
            Plan.member_id,
            User.first_name,
            User.last_name,
            Plan.created_at,
        )
        .order_by(Plan.week_start_date.desc(), Plan.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await session.execute(plans_query)).all()
    items = [
        TeamPlanSummaryOut(
            id=r.id,
            team_id=r.team_id,
            week_start_date=r.week_start_date,
            status=r.status,
            task_count=r.task_count,
            done_count=r.done_count,
            main_shipped=r.main_shipped,
            author=AuthorInfo(
                member_id=r.member_id,
                first_name=r.first_name,
                last_name=r.last_name,
            ),
        )
        for r in rows
    ]
    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/orgs/{org_id}/teams/{team_id}/plans/{plan_id}",
    response_model=TeamPlanOut,
    dependencies=[Depends(RequirePermission("plan.view_team", allowed_scopes="team"))],
)
async def get_team_plan(
    org_id: UUID,
    team_id: UUID,
    plan_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> TeamPlanOut:
    """Retrieve full plan details with author info for review. Drafts are never visible."""
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.team_id == team_id,
            Plan.org_id == org_id,
        )
    )
    if not plan or plan.status == "draft":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    tasks = (
        await session.scalars(
            select(PlanTask).where(PlanTask.plan_id == plan.id).order_by(PlanTask.order_index)
        )
    ).all()

    author_membership = await session.scalar(
        select(Membership)
        .options(joinedload(Membership.user))
        .where(Membership.id == plan.member_id)
    )
    first_name = author_membership.user.first_name if author_membership and author_membership.user else None
    last_name = author_membership.user.last_name if author_membership and author_membership.user else None

    base_out = build_plan_out(plan, list(tasks))
    return TeamPlanOut(
        **base_out.model_dump(),
        author=AuthorInfo(
            member_id=plan.member_id,
            first_name=first_name,
            last_name=last_name,
        ),
    )


@router.post(
    "/orgs/{org_id}/teams/{team_id}/plans/{plan_id}/approve",
    response_model=PlanOut,
    dependencies=[Depends(RequirePermission("plan.approve", allowed_scopes="team"))],
)
async def approve_team_plan(
    org_id: UUID,
    team_id: UUID,
    plan_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> PlanOut:
    """Approve a submitted team plan. Team leads cannot approve their own plan."""
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="NOT_AUTHORIZED",
            message="Active membership not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.team_id == team_id,
            Plan.org_id == org_id,
        )
    )
    if not plan or plan.status == "draft":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    if plan.member_id == caller_membership.id:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="CANNOT_APPROVE_OWN_PLAN",
            message="You cannot approve your own plan",
        )

    if plan.status != "submitted":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="INVALID_PLAN_STATUS",
            message=f"Only submitted plans can be approved. Current status: '{plan.status}'",
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    plan.status = "approved"
    plan.approved_at = now
    plan.approved_by_member_id = caller_membership.id
    await session.commit()

    tasks = (
        await session.scalars(
            select(PlanTask).where(PlanTask.plan_id == plan.id).order_by(PlanTask.order_index)
        )
    ).all()
    return build_plan_out(plan, list(tasks))


@router.post(
    "/orgs/{org_id}/teams/{team_id}/plans/{plan_id}/return",
    response_model=PlanOut,
    dependencies=[Depends(RequirePermission("plan.return", allowed_scopes="team"))],
)
async def return_team_plan(
    org_id: UUID,
    team_id: UUID,
    plan_id: UUID,
    payload: ReturnPlanRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> PlanOut:
    """Return a submitted plan back to draft with lead feedback. Leads cannot return their own plan."""
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    caller_membership = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_membership:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="NOT_AUTHORIZED",
            message="Active membership not found",
        )

    plan = await session.scalar(
        select(Plan).where(
            Plan.id == plan_id,
            Plan.team_id == team_id,
            Plan.org_id == org_id,
        )
    )
    if not plan or plan.status == "draft":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found",
        )

    if plan.member_id == caller_membership.id:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="CANNOT_RETURN_OWN_PLAN",
            message="You cannot return your own plan",
        )

    if plan.status != "submitted":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="INVALID_PLAN_STATUS",
            message=f"Only submitted plans can be returned. Current status: '{plan.status}'",
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    plan.status = "draft"
    plan.returned_at = now
    plan.lead_comment = payload.comment
    await session.commit()

    tasks = (
        await session.scalars(
            select(PlanTask).where(PlanTask.plan_id == plan.id).order_by(PlanTask.order_index)
        )
    ).all()
    return build_plan_out(plan, list(tasks))


@router.get(
    "/orgs/{org_id}/teams/{team_id}/week",
    response_model=TeamWeekViewOut,
    dependencies=[Depends(RequirePermission("team.week.view", allowed_scopes="team"))],
)
async def get_team_week_view(
    org_id: UUID,
    team_id: UUID,
    week_start_date: datetime.date,
    current_user: CurrentUser,
    session: DBSession,
) -> TeamWeekViewOut:
    """View team members and plan progress for a given Monday."""
    if week_start_date.weekday() != 0:
        raise APIException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_WEEK_START_DATE",
            message="week_start_date must be a Monday",
        )

    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found",
        )

    tm_rows = (
        await session.execute(
            select(TeamMember, Membership, User)
            .join(Membership, Membership.id == TeamMember.member_id)
            .join(User, User.id == Membership.user_id)
            .where(
                TeamMember.team_id == team_id,
                TeamMember.org_id == org_id,
                TeamMember.membership_status == "active",
                Membership.status == "active",
            )
            .order_by(User.first_name, User.last_name, User.email)
        )
    ).all()

    member_ids = [r[1].id for r in tm_rows]
    plans = []
    if member_ids:
        plans = (
            await session.scalars(
                select(Plan).where(
                    Plan.team_id == team_id,
                    Plan.org_id == org_id,
                    Plan.week_start_date == week_start_date,
                    Plan.member_id.in_(member_ids),
                    Plan.status.in_(["submitted", "approved", "done"]),
                )
            )
        ).all()

    plan_ids = [p.id for p in plans]
    task_counts: dict[UUID, tuple[int, int]] = {}
    if plan_ids:
        t_rows = (
            await session.execute(
                select(
                    PlanTask.plan_id,
                    func.count(PlanTask.id),
                    func.count(case((PlanTask.status == "done", PlanTask.id))),
                )
                .where(PlanTask.plan_id.in_(plan_ids))
                .group_by(PlanTask.plan_id)
            )
        ).all()
        for pid, total_cnt, done_cnt in t_rows:
            task_counts[pid] = (total_cnt, done_cnt)

    plan_by_member = {p.member_id: p for p in plans}
    members_out: list[TeamWeekMember] = []
    totals = {"members": len(tm_rows), "no_plan": 0, "submitted": 0, "approved": 0, "done": 0}

    for tm, mem, user in tm_rows:
        p = plan_by_member.get(mem.id)
        if p:
            st = p.status
            totals[st] = totals.get(st, 0) + 1
            t_total, t_done = task_counts.get(p.id, (0, 0))
            members_out.append(
                TeamWeekMember(
                    member_id=mem.id,
                    first_name=user.first_name,
                    last_name=user.last_name,
                    plan_id=p.id,
                    status=st,
                    tasks_total=t_total,
                    tasks_done=t_done,
                    main_shipped=p.main_shipped,
                )
            )
        else:
            totals["no_plan"] += 1
            members_out.append(
                TeamWeekMember(
                    member_id=mem.id,
                    first_name=user.first_name,
                    last_name=user.last_name,
                    plan_id=None,
                    status="no_plan",
                    tasks_total=0,
                    tasks_done=0,
                    main_shipped=None,
                )
            )

    return TeamWeekViewOut(
        week_start_date=week_start_date,
        members=members_out,
        totals=TeamWeekTotals(**totals),
    )


@router.get(
    "/orgs/{org_id}/teams/{team_id}/history",
    response_model=PaginatedResponse[TeamHistoryWeekSummary],
    dependencies=[Depends(RequirePermission("team.history.view", allowed_scopes="team"))],
)
async def get_team_history(
    org_id: UUID,
    team_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
    from_date: datetime.date | None = Query(None, alias="from"),
    to_date: datetime.date | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PaginatedResponse[TeamHistoryWeekSummary]:
    """View weekly history metrics for a team. Newest first, current week and earlier only."""
    team = await session.scalar(
        select(Team).where(Team.id == team_id, Team.org_id == org_id)
    )
    if not team:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TEAM_NOT_FOUND",
            message="Team not found",
        )

    active_members_count = (
        await session.scalar(
            select(func.count(TeamMember.id)).where(
                TeamMember.team_id == team_id,
                TeamMember.org_id == org_id,
                TeamMember.membership_status == "active",
            )
        )
    ) or 0

    today = datetime.date.today()
    current_monday = today - datetime.timedelta(days=today.weekday())
    max_date = min(current_monday, to_date) if to_date else current_monday

    weeks_query = (
        select(Plan.week_start_date)
        .where(
            Plan.team_id == team_id,
            Plan.org_id == org_id,
            Plan.status.in_(["submitted", "approved", "done"]),
            Plan.week_start_date <= max_date,
        )
    )
    if from_date:
        weeks_query = weeks_query.where(Plan.week_start_date >= from_date)

    weeks_query = weeks_query.distinct().order_by(Plan.week_start_date.desc())
    distinct_weeks = (await session.scalars(weeks_query)).all()
    total = len(distinct_weeks)

    paged_weeks = distinct_weeks[(page - 1) * page_size : page * page_size]
    items: list[TeamHistoryWeekSummary] = []

    for w in paged_weeks:
        w_plans = (
            await session.scalars(
                select(Plan).where(
                    Plan.team_id == team_id,
                    Plan.org_id == org_id,
                    Plan.week_start_date == w,
                    Plan.status.in_(["submitted", "approved", "done"]),
                )
            )
        ).all()
        w_plan_ids = [p.id for p in w_plans]
        submitted_cnt = sum(1 for p in w_plans if p.status == "submitted")
        approved_cnt = sum(1 for p in w_plans if p.status == "approved")
        done_cnt = sum(1 for p in w_plans if p.status == "done")
        shipped_cnt = sum(1 for p in w_plans if p.main_shipped is True)

        tasks_total = 0
        tasks_done = 0
        if w_plan_ids:
            t_res = (
                await session.execute(
                    select(
                        func.count(PlanTask.id),
                        func.count(case((PlanTask.status == "done", PlanTask.id))),
                    ).where(PlanTask.plan_id.in_(w_plan_ids))
                )
            ).first()
            if t_res:
                tasks_total = t_res[0] or 0
                tasks_done = t_res[1] or 0

        items.append(
            TeamHistoryWeekSummary(
                week_start_date=w,
                members=active_members_count,
                submitted=submitted_cnt,
                approved=approved_cnt,
                done=done_cnt,
                shipped=shipped_cnt,
                tasks_total=tasks_total,
                tasks_done=tasks_done,
            )
        )

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )

