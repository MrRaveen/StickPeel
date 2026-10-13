"""Invitation routes.

Permissions:
- POST   /orgs/{org_id}/invitations                 requires "invite.manage" (scope: org)
- GET    /orgs/{org_id}/invitations                 requires "invite.manage" (scope: org)
- POST   /orgs/{org_id}/invitations/{invitation_id}/renew requires "invite.manage" (scope: org)
- DELETE /orgs/{org_id}/invitations/{invitation_id}        requires "invite.manage" (scope: org)
- GET    /invitations/{token}                       Public
- POST   /invitations/{token}/accept                Authenticated
"""
from __future__ import annotations

import datetime
import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func, select

from app.api.app.access import CurrentUser
from app.api.app.schemas import (
    AcceptOut,
    InvitationCreate,
    InvitationCreatorInfo,
    InvitationOut,
    InvitationPublic,
    OrgOut,
)
from app.config import settings
from app.database import DBSession
from app.exceptions import APIException
from app.models import Invitation, Membership, Organization, Role, User
from app.rbac import RequirePermission
from app.schemas import PaginatedResponse

router = APIRouter(tags=["invitations"])


def mask_email(email: str) -> str:
    """Mask email for public invitation lookup (e.g. r***@gmail.com)."""
    if "@" not in email:
        return email
    local, domain = email.split("@", 1)
    if len(local) <= 1:
        masked_local = local + "***"
    else:
        masked_local = local[0] + "***"
    return f"{masked_local}@{domain}"


def build_invitation_out(
    inv: Invitation,
    role_name: str,
    creator: User | None,
    now: datetime.datetime,
) -> InvitationOut:
    """Format an Invitation model instance into InvitationOut schema."""
    if inv.active_status == "pending":
        if inv.expires_at is not None and inv.expires_at < now:
            derived_status = "expired"
            link = None
        else:
            derived_status = "pending"
            link = inv.link
    elif inv.active_status in ("accepted", "cancelled"):
        derived_status = inv.active_status
        link = None
    else:
        derived_status = "cancelled"
        link = None

    creator_name = (
        f"{creator.first_name} {creator.last_name}".strip()
        if creator
        else "Unknown"
    )

    return InvitationOut(
        id=inv.id,
        email=inv.email,
        role_name=role_name,
        status=derived_status,
        link=link,
        expires_at=inv.expires_at or now,
        created_by=InvitationCreatorInfo(
            user_id=inv.created_by,
            name=creator_name or "Unknown",
        ),
        created_at=inv.created_at,
        accepted_at=inv.accepted_at,
    )


# ---------------------------------------------------------------------------
# 1. Create Invitation — requires "invite.manage" (org scope)
# ---------------------------------------------------------------------------


@router.post(
    "/orgs/{org_id}/invitations",
    response_model=InvitationOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RequirePermission("invite.manage", allowed_scopes="org"))],
)
async def create_invitation(
    org_id: UUID,
    payload: InvitationCreate,
    current_user: CurrentUser,
    session: DBSession,
) -> InvitationOut:
    email = payload.email.strip().lower()
    if not email or "@" not in email or "." not in email:
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="INVALID_EMAIL",
            message="Valid email address is required.",
        )

    # Validate allowed role
    if payload.role_name == "owner" or payload.role_name not in ("admin", "member"):
        raise APIException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="INVALID_ROLE",
            message="Role must be 'member' or 'admin'. Owner invitations are not allowed.",
        )

    caller_mem = await session.scalar(
        select(Membership).where(
            Membership.org_id == org_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    )
    if not caller_mem:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message="Caller active membership not found.",
        )

    caller_role = await session.get(Role, caller_mem.role_id)
    if not caller_role:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="not_allowed",
            message="Caller role not found.",
        )

    # Only an owner can invite an admin
    if payload.role_name == "admin" and caller_role.name != "owner":
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="not_allowed",
            message="Only an owner can invite an admin.",
        )

    target_role = await session.scalar(
        select(Role).where(
            Role.name == payload.role_name,
            Role.scope == "org",
            Role.is_sys.is_(True),
        )
    )
    if not target_role:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="role_unavailable",
            message=f"Role '{payload.role_name}' is unavailable.",
        )

    # Check if a user with this email is already a member of this org
    existing_member = await session.scalar(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.org_id == org_id,
            func.lower(User.email) == email,
        )
    )
    if existing_member:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="already_member",
            message="A user with this email is already a member of this organization.",
        )

    now = datetime.datetime.now(datetime.timezone.utc)

    # Check if a pending invitation exists for that email
    existing_inv = await session.scalar(
        select(Invitation).where(
            Invitation.org_id == org_id,
            func.lower(Invitation.email) == email,
            Invitation.active_status == "pending",
        )
    )
    if existing_inv:
        if existing_inv.expires_at is not None and existing_inv.expires_at >= now:
            raise APIException(
                status_code=status.HTTP_409_CONFLICT,
                code="invitation_exists",
                message="A pending invitation already exists for this email.",
                extra={"invitation_id": str(existing_inv.id)},
            )
        # Old invitation is expired, soft cancel it to avoid index conflict
        existing_inv.active_status = "cancelled"
        await session.flush()

    token = secrets.token_urlsafe(32)  # 43 characters
    expires_at = now + datetime.timedelta(days=settings.INVITE_EXPIRE_DAYS)
    link = f"{settings.APP_URL}/accept-invite?token={token}"

    inv = Invitation(
        org_id=org_id,
        token=token,
        link=link,
        role_id=target_role.id,
        email=email,
        created_by=current_user.id,
        active_status="pending",
        expires_at=expires_at,
    )
    session.add(inv)
    await session.commit()
    await session.refresh(inv)

    return build_invitation_out(inv, target_role.name, current_user, now)


# ---------------------------------------------------------------------------
# 2. List Invitations — requires "invite.manage" (org scope)
# ---------------------------------------------------------------------------


@router.get(
    "/orgs/{org_id}/invitations",
    response_model=PaginatedResponse[InvitationOut],
    dependencies=[Depends(RequirePermission("invite.manage", allowed_scopes="org"))],
)
async def list_invitations(
    org_id: UUID,
    session: DBSession,
    status_filter: str | None = Query(None, alias="status"),
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PaginatedResponse[InvitationOut]:
    now = datetime.datetime.now(datetime.timezone.utc)

    base_query = select(Invitation).where(Invitation.org_id == org_id)

    if q and q.strip():
        base_query = base_query.where(
            func.lower(Invitation.email).contains(q.strip().lower())
        )

    if status_filter and status_filter != "all":
        if status_filter == "pending":
            base_query = base_query.where(
                Invitation.active_status == "pending",
                Invitation.expires_at >= now,
            )
        elif status_filter == "expired":
            base_query = base_query.where(
                Invitation.active_status == "pending",
                Invitation.expires_at < now,
            )
        elif status_filter in ("accepted", "cancelled"):
            base_query = base_query.where(
                Invitation.active_status == status_filter
            )

    count_query = select(func.count()).select_from(base_query.subquery())
    total = (await session.scalar(count_query)) or 0

    items_query = (
        base_query.order_by(Invitation.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    invitations = (await session.scalars(items_query)).all()

    # Bulk load roles and creators
    role_ids = list({inv.role_id for inv in invitations})
    creator_ids = list({inv.created_by for inv in invitations})

    roles_map: dict[UUID, Role] = {}
    if role_ids:
        roles = (
            await session.scalars(select(Role).where(Role.id.in_(role_ids)))
        ).all()
        roles_map = {r.id: r for r in roles}

    creators_map: dict[UUID, User] = {}
    if creator_ids:
        creators = (
            await session.scalars(select(User).where(User.id.in_(creator_ids)))
        ).all()
        creators_map = {u.id: u for u in creators}

    items = [
        build_invitation_out(
            inv,
            roles_map[inv.role_id].name if inv.role_id in roles_map else "member",
            creators_map.get(inv.created_by),
            now,
        )
        for inv in invitations
    ]

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------
# 3. Renew Invitation — requires "invite.manage" (org scope)
# ---------------------------------------------------------------------------


@router.post(
    "/orgs/{org_id}/invitations/{invitation_id}/renew",
    response_model=InvitationOut,
    dependencies=[Depends(RequirePermission("invite.manage", allowed_scopes="org"))],
)
async def renew_invitation(
    org_id: UUID,
    invitation_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> InvitationOut:
    inv = await session.scalar(
        select(Invitation).where(
            Invitation.id == invitation_id,
            Invitation.org_id == org_id,
        )
    )
    if not inv:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message="Invitation not found.",
        )

    # Works on pending or expired invitations (not accepted or cancelled, else 409)
    if inv.active_status in ("accepted", "cancelled"):
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="invitation_not_pending",
            message="Cannot renew an invitation that has already been accepted or cancelled.",
        )

    role = await session.get(Role, inv.role_id)
    if not role:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="role_unavailable",
            message="Role associated with invitation is no longer available.",
        )

    # An admin cannot renew an admin invitation (only owner can)
    if role.name == "admin":
        caller_mem = await session.scalar(
            select(Membership).where(
                Membership.org_id == org_id,
                Membership.user_id == current_user.id,
                Membership.status == "active",
            )
        )
        caller_role = await session.get(Role, caller_mem.role_id) if caller_mem else None
        if not caller_role or caller_role.name != "owner":
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_allowed",
                message="Only an owner can renew an admin invitation.",
            )

    now = datetime.datetime.now(datetime.timezone.utc)
    new_token = secrets.token_urlsafe(32)
    new_expires = now + datetime.timedelta(days=settings.INVITE_EXPIRE_DAYS)
    new_link = f"{settings.APP_URL}/accept-invite?token={new_token}"

    inv.token = new_token
    inv.expires_at = new_expires
    inv.link = new_link
    inv.active_status = "pending"
    await session.commit()
    await session.refresh(inv)

    creator = await session.get(User, inv.created_by)
    return build_invitation_out(inv, role.name, creator, now)


# ---------------------------------------------------------------------------
# 4. Cancel Invitation (Soft Delete) — requires "invite.manage" (org scope)
# ---------------------------------------------------------------------------


@router.delete(
    "/orgs/{org_id}/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(RequirePermission("invite.manage", allowed_scopes="org"))],
)
async def cancel_invitation(
    org_id: UUID,
    invitation_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> Response:
    inv = await session.scalar(
        select(Invitation).where(
            Invitation.id == invitation_id,
            Invitation.org_id == org_id,
        )
    )
    if not inv:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message="Invitation not found.",
        )

    if inv.active_status != "pending":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="invitation_not_pending",
            message="Only pending invitations can be cancelled.",
        )

    role = await session.get(Role, inv.role_id)
    if role and role.name == "admin":
        caller_mem = await session.scalar(
            select(Membership).where(
                Membership.org_id == org_id,
                Membership.user_id == current_user.id,
                Membership.status == "active",
            )
        )
        caller_role = await session.get(Role, caller_mem.role_id) if caller_mem else None
        if not caller_role or caller_role.name != "owner":
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_allowed",
                message="Only an owner can cancel an admin invitation.",
            )

    inv.active_status = "cancelled"
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 5. Public Invitation Lookup (No auth required)
# ---------------------------------------------------------------------------


@router.get(
    "/invitations/{token}",
    response_model=InvitationPublic,
)
async def get_public_invitation(
    token: str,
    session: DBSession,
) -> InvitationPublic:
    # Reject tokens that are not 43 characters before querying
    if len(token) != 43:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invitation_invalid",
            message="This invitation is invalid or has expired.",
        )

    inv = await session.scalar(
        select(Invitation).where(Invitation.token == token)
    )
    if not inv:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invitation_invalid",
            message="This invitation is invalid or has expired.",
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    if inv.active_status != "pending" or inv.expires_at is None or inv.expires_at < now:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invitation_invalid",
            message="This invitation is invalid or has expired.",
        )

    org = await session.get(Organization, inv.org_id)
    if not org or org.is_suspended:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invitation_invalid",
            message="This invitation is invalid or has expired.",
        )

    role = await session.get(Role, inv.role_id)
    if not role or role.name == "owner" or role.scope != "org":
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invitation_invalid",
            message="This invitation is invalid or has expired.",
        )

    return InvitationPublic(
        organization_name=org.name,
        organization_logo_url=org.logo_url,
        role_name=role.name,
        masked_email=mask_email(inv.email),
        email=inv.email,
        expires_at=inv.expires_at,
    )


# ---------------------------------------------------------------------------
# 6. Accept Invitation — Authenticated caller
# ---------------------------------------------------------------------------


@router.post(
    "/invitations/{token}/accept",
    response_model=AcceptOut,
    status_code=status.HTTP_201_CREATED,
)
async def accept_invitation(
    token: str,
    current_user: CurrentUser,
    session: DBSession,
) -> AcceptOut:
    # 1. User is active
    if not current_user.is_active:
        raise APIException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthenticated",
            message="User account is deactivated.",
        )

    # 2. Token length check
    if len(token) != 43:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invitation_invalid",
            message="This invitation is invalid or has expired.",
        )

    now = datetime.datetime.now(datetime.timezone.utc)

    # 3. Lock the invitation row by token in transaction
    inv = await session.scalar(
        select(Invitation)
        .where(Invitation.token == token)
        .with_for_update()
    )
    if not inv:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invitation_invalid",
            message="This invitation is invalid or has expired.",
        )

    # 4. Must be pending and not expired
    if inv.active_status != "pending" or inv.expires_at is None or inv.expires_at < now:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invitation_invalid",
            message="This invitation is invalid or has expired.",
        )

    # 5. Org exists and is not suspended
    org = await session.get(Organization, inv.org_id)
    if not org or org.is_suspended:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invitation_invalid",
            message="This invitation is invalid or has expired.",
        )

    # 6. Check existing membership in this org
    existing_mem = await session.scalar(
        select(Membership).where(
            Membership.org_id == org.id,
            Membership.user_id == current_user.id,
        )
    )
    if existing_mem:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="already_member",
            message="You are already a member of this organization.",
            extra={"organization_id": str(org.id)},
        )

    # 7. Strict mode check (if enabled)
    if settings.INVITE_STRICT_MODE:
        if current_user.email.strip().lower() != inv.email.strip().lower():
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="email_mismatch",
                message="This invitation was sent to a different email address.",
            )

    # 8. Role still exists, scope='org', and is not owner
    role = await session.get(Role, inv.role_id)
    if not role or role.scope != "org" or role.name == "owner":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="role_unavailable",
            message="The invited role is no longer available.",
        )

    # 9. Create active membership
    membership = Membership(
        org_id=org.id,
        user_id=current_user.id,
        role_id=role.id,
        status="active",
    )
    session.add(membership)
    await session.flush()

    # 10. Mark invitation accepted
    inv.active_status = "accepted"
    inv.accepted_by_user_id = current_user.id
    inv.accepted_at = now

    await session.commit()

    return AcceptOut(
        organization=OrgOut(
            id=org.id,
            name=org.name,
            address=org.address,
            logo_url=org.logo_url,
            is_suspended=org.is_suspended,
            created_at=org.created_at,
        ),
        role_name=role.name,
        membership_id=membership.id,
    )
