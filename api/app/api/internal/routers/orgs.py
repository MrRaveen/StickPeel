from __future__ import annotations

import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.internal.schemas import (
    AiCalls30d,
    OrgDetail,
    OrgListResponse,
    OrgMemberListResponse,
    OrgMemberRow,
    OrgOwner,
    OrgRow,
    PlansByStatus,
    SuspendRequest,
)
from app.database import DBSession
from app.exceptions import ConflictException, ResourceNotFoundException
from app.models import AICall, Membership, Organization, Plan, Role, StaffAuditLog, Team, User
from app.rbac import require_platform_permission

router = APIRouter(tags=["orgs"])


async def _get_org_row(session: AsyncSession, org: Organization) -> OrgRow:
    member_count = (
        await session.scalar(
            select(func.count(Membership.id)).where(
                Membership.org_id == org.id, Membership.status == "active"
            )
        )
    ) or 0
    team_count = (
        await session.scalar(
            select(func.count(Team.id)).where(Team.org_id == org.id)
        )
    ) or 0
    plan_count = (
        await session.scalar(
            select(func.count(Plan.id)).where(Plan.org_id == org.id)
        )
    ) or 0
    return OrgRow(
        id=org.id,
        name=org.name,
        is_suspended=org.is_suspended,
        member_count=member_count,
        team_count=team_count,
        plan_count=plan_count,
        last_active_at=org.last_active_at,
        created_at=org.created_at,
    )


@router.get(
    "/orgs",
    dependencies=[Depends(require_platform_permission("platform.org.view"))],
)
async def list_orgs(
    session: DBSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None),
    is_suspended: bool | None = Query(None),
    sort: str | None = Query(None),
) -> OrgListResponse:
    """List organizations with metadata and grouped counts."""
    member_counts = (
        select(Membership.org_id, func.count(Membership.id).label("cnt"))
        .where(Membership.status == "active")
        .group_by(Membership.org_id)
        .subquery()
    )
    team_counts = (
        select(Team.org_id, func.count(Team.id).label("cnt"))
        .group_by(Team.org_id)
        .subquery()
    )
    plan_counts = (
        select(Plan.org_id, func.count(Plan.id).label("cnt"))
        .group_by(Plan.org_id)
        .subquery()
    )

    stmt = (
        select(
            Organization,
            func.coalesce(member_counts.c.cnt, 0),
            func.coalesce(team_counts.c.cnt, 0),
            func.coalesce(plan_counts.c.cnt, 0),
        )
        .outerjoin(member_counts, member_counts.c.org_id == Organization.id)
        .outerjoin(team_counts, team_counts.c.org_id == Organization.id)
        .outerjoin(plan_counts, plan_counts.c.org_id == Organization.id)
    )

    if q:
        stmt = stmt.where(Organization.name.ilike(f"%{q}%"))
    if is_suspended is not None:
        stmt = stmt.where(Organization.is_suspended == is_suspended)

    count_stmt = select(func.count()).select_from(Organization)
    if q:
        count_stmt = count_stmt.where(Organization.name.ilike(f"%{q}%"))
    if is_suspended is not None:
        count_stmt = count_stmt.where(Organization.is_suspended == is_suspended)

    total = (await session.scalar(count_stmt)) or 0

    sort_mapping = {
        "name": Organization.name.asc(),
        "-name": Organization.name.desc(),
        "last_active_at": Organization.last_active_at.desc().nullslast(),
        "-last_active_at": Organization.last_active_at.desc().nullslast(),
        "+last_active_at": Organization.last_active_at.asc().nullsfirst(),
        "created_at": Organization.created_at.desc(),
        "-created_at": Organization.created_at.desc(),
        "+created_at": Organization.created_at.asc(),
    }
    order_clause = sort_mapping.get(sort, Organization.created_at.desc()) if sort else Organization.created_at.desc()

    offset = (page - 1) * page_size
    stmt = stmt.order_by(order_clause).offset(offset).limit(page_size)

    rows = (await session.execute(stmt)).all()

    items = [
        OrgRow(
            id=org.id,
            name=org.name,
            is_suspended=org.is_suspended,
            member_count=member_count or 0,
            team_count=team_count or 0,
            plan_count=plan_count or 0,
            last_active_at=org.last_active_at,
            created_at=org.created_at,
        )
        for org, member_count, team_count, plan_count in rows
    ]

    return OrgListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/orgs/{org_id}",
    dependencies=[Depends(require_platform_permission("platform.org.view"))],
)
async def get_org_detail(
    org_id: UUID,
    session: DBSession,
) -> OrgDetail:
    """Get organization details with owners and counts. No plan text returned."""
    org = await session.get(Organization, org_id)
    if not org:
        raise ResourceNotFoundException("Organization not found")

    member_count = (
        await session.scalar(
            select(func.count(Membership.id)).where(
                Membership.org_id == org.id, Membership.status == "active"
            )
        )
    ) or 0

    team_count = (
        await session.scalar(
            select(func.count(Team.id)).where(Team.org_id == org.id)
        )
    ) or 0

    plan_count = (
        await session.scalar(
            select(func.count(Plan.id)).where(Plan.org_id == org.id)
        )
    ) or 0

    owners_res = await session.execute(
        select(User.id, User.first_name, User.last_name, User.email)
        .join(Membership, Membership.user_id == User.id)
        .join(Role, Role.id == Membership.role_id)
        .where(
            Membership.org_id == org.id,
            Membership.status == "active",
            Role.name == "owner",
        )
    )
    owners = [
        OrgOwner(
            user_id=row.id,
            name=f"{row.first_name} {row.last_name}".strip(),
            email=row.email,
        )
        for row in owners_res
    ]

    status_res = await session.execute(
        select(Plan.status, func.count(Plan.id))
        .where(Plan.org_id == org.id)
        .group_by(Plan.status)
    )
    status_map = {row[0]: row[1] for row in status_res}
    plans_by_status = PlansByStatus(
        draft=status_map.get("draft", 0),
        submitted=status_map.get("submitted", 0),
        approved=status_map.get("approved", 0),
        done=status_map.get("done", 0),
    )

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)
    ai_res = await session.execute(
        select(
            func.count(AICall.id),
            func.count(case((AICall.status == "failed", AICall.id))),
            func.count(case((AICall.status == "rate_limited", AICall.id))),
        ).where(AICall.org_id == org.id, AICall.created_at >= since)
    )
    row = ai_res.first()
    total_ai = row[0] if row else 0
    failed_ai = row[1] if row else 0
    rl_ai = row[2] if row else 0

    ai_calls_30d = AiCalls30d(
        total=total_ai or 0,
        failed=failed_ai or 0,
        rate_limited=rl_ai or 0,
    )

    return OrgDetail(
        id=org.id,
        name=org.name,
        is_suspended=org.is_suspended,
        member_count=member_count,
        team_count=team_count,
        plan_count=plan_count,
        last_active_at=org.last_active_at,
        created_at=org.created_at,
        address=org.address,
        logo_url=org.logo_url,
        owners=owners,
        plans_by_status=plans_by_status,
        ai_calls_30d=ai_calls_30d,
    )


@router.get(
    "/orgs/{org_id}/members",
    dependencies=[Depends(require_platform_permission("platform.org.view"))],
)
async def get_org_members(
    org_id: UUID,
    session: DBSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> OrgMemberListResponse:
    """List members of an organization with roles and statuses."""
    org = await session.get(Organization, org_id)
    if not org:
        raise ResourceNotFoundException("Organization not found")

    stmt = (
        select(Membership, User, Role.name)
        .join(User, User.id == Membership.user_id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.org_id == org_id)
    )

    count_stmt = select(func.count(Membership.id)).where(Membership.org_id == org_id)
    total = (await session.scalar(count_stmt)) or 0

    offset = (page - 1) * page_size
    stmt = stmt.order_by(Membership.created_at.desc()).offset(offset).limit(page_size)

    rows = (await session.execute(stmt)).all()

    items = [
        OrgMemberRow(
            membership_id=mem.id,
            user_id=user.id,
            email=user.email,
            name=f"{user.first_name} {user.last_name}".strip(),
            role=role_name,
            status=mem.status,
            joined_at=mem.created_at,
        )
        for mem, user, role_name in rows
    ]

    return OrgMemberListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/orgs/{org_id}/suspend",
)
async def suspend_org(
    org_id: UUID,
    session: DBSession,
    current_user: User = Depends(require_platform_permission("platform.org.suspend")),
    payload: SuspendRequest = SuspendRequest(),
) -> OrgRow:
    """Suspend an organization, set is_suspended = True, write audit log with action org.suspend, and return OrgRow."""
    org = await session.get(Organization, org_id)
    if not org:
        raise ResourceNotFoundException("Organization not found")

    if org.is_suspended:
        raise ConflictException("Organization is already suspended.")

    org.is_suspended = True

    audit = StaffAuditLog(
        staff_user_id=current_user.id,
        action="org.suspend",
        target_type="organization",
        target_id=str(org.id),
        detail=payload.reason,
    )
    session.add(audit)
    await session.flush()
    await session.commit()

    return await _get_org_row(session, org)


@router.post(
    "/orgs/{org_id}/reinstate",
)
async def reinstate_org(
    org_id: UUID,
    session: DBSession,
    current_user: User = Depends(require_platform_permission("platform.org.suspend")),
) -> OrgRow:
    """Reinstate an organization, set is_suspended = False, write audit log with action org.reinstate, and return OrgRow."""
    org = await session.get(Organization, org_id)
    if not org:
        raise ResourceNotFoundException("Organization not found")

    if not org.is_suspended:
        raise ConflictException("Organization is not suspended.")

    org.is_suspended = False

    audit = StaffAuditLog(
        staff_user_id=current_user.id,
        action="org.reinstate",
        target_type="organization",
        target_id=str(org.id),
        detail=None,
    )
    session.add(audit)
    await session.flush()
    await session.commit()

    return await _get_org_row(session, org)
