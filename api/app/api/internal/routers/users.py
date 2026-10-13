from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select

from app.api.internal.access import CurrentInternalUser
from app.api.internal.schemas import (
    DeactivateRequest,
    InternalSelfResponse,
    UserDetail,
    UserListResponse,
    UserMembership,
    UserRow,
)
from app.database import DBSession
from app.exceptions import APIException, ConflictException, ResourceNotFoundException
from app.models import Membership, Organization, PlatformMember, Role, StaffAuditLog, User
from app.rbac import (
    get_permissions_for_roles,
    require_platform_permission,
    resolve_platform_roles,
)

router = APIRouter(tags=["users"])


@router.get("/users/self")
async def get_self(
    current_user: CurrentInternalUser,
    session: DBSession,
) -> InternalSelfResponse:
    """Return the authenticated staff user's profile and assigned platform permissions."""
    role_row = (
        await session.execute(
            select(Role)
            .join(PlatformMember, PlatformMember.role_id == Role.id)
            .where(PlatformMember.user_id == current_user.id)
        )
    ).scalar_one_or_none()

    if role_row is None:
        raise APIException(
            status_code=403,
            code="NOT_AUTHORIZED",
            message="User has no platform roles assigned.",
        )

    assigned = await get_permissions_for_roles(session, [role_row.id])

    return InternalSelfResponse(
        user_id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=role_row.name,
        permissions=sorted(list(assigned)),
    )


@router.get(
    "/users",
    dependencies=[Depends(require_platform_permission("platform.user.view"))],
)
async def list_users(
    session: DBSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None),
    is_active: bool | None = Query(None),
    is_staff: bool | None = Query(None),
) -> UserListResponse:
    """List users across the platform with account metadata and org counts."""
    org_count_subq = (
        select(func.count(Membership.id))
        .where(Membership.user_id == User.id, Membership.status == "active")
        .scalar_subquery()
    )

    stmt = select(User, org_count_subq)

    if q:
        filter_pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                User.email.ilike(filter_pattern),
                User.first_name.ilike(filter_pattern),
                User.last_name.ilike(filter_pattern),
            )
        )
    if is_active is not None:
        stmt = stmt.where(User.is_active == is_active)
    if is_staff is not None:
        stmt = stmt.where(User.is_admin == is_staff)

    count_stmt = select(func.count()).select_from(User)
    if q:
        filter_pattern = f"%{q}%"
        count_stmt = count_stmt.where(
            or_(
                User.email.ilike(filter_pattern),
                User.first_name.ilike(filter_pattern),
                User.last_name.ilike(filter_pattern),
            )
        )
    if is_active is not None:
        count_stmt = count_stmt.where(User.is_active == is_active)
    if is_staff is not None:
        count_stmt = count_stmt.where(User.is_admin == is_staff)

    total = (await session.scalar(count_stmt)) or 0

    offset = (page - 1) * page_size
    stmt = stmt.order_by(User.created_at.desc()).offset(offset).limit(page_size)

    rows = (await session.execute(stmt)).all()

    items = [
        UserRow(
            id=u.id,
            email=u.email,
            first_name=u.first_name,
            last_name=u.last_name,
            is_active=u.is_active,
            is_staff=u.is_admin,
            org_count=org_count or 0,
            created_at=u.created_at,
        )
        for u, org_count in rows
    ]

    return UserListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/users/{user_id}",
    dependencies=[Depends(require_platform_permission("platform.user.view"))],
)
async def get_user_detail(
    user_id: uuid.UUID,
    session: DBSession,
) -> UserDetail:
    """Get user details including organizations and memberships. No plan text returned."""
    user = await session.get(User, user_id)
    if not user:
        raise ResourceNotFoundException("User not found")

    org_count = (
        await session.scalar(
            select(func.count(Membership.id)).where(
                Membership.user_id == user.id, Membership.status == "active"
            )
        )
    ) or 0

    mem_rows = (
        await session.execute(
            select(Membership, Organization, Role)
            .join(Organization, Organization.id == Membership.org_id)
            .join(Role, Role.id == Membership.role_id)
            .where(Membership.user_id == user.id)
            .order_by(Organization.name)
        )
    ).all()

    memberships = [
        UserMembership(
            org_id=org.id,
            org_name=org.name,
            org_suspended=org.is_suspended,
            role=role.name,
            status=mem.status,
        )
        for mem, org, role in mem_rows
    ]

    return UserDetail(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        is_active=user.is_active,
        is_staff=user.is_admin,
        org_count=org_count,
        created_at=user.created_at,
        memberships=memberships,
    )


@router.post(
    "/users/{user_id}/deactivate",
    dependencies=[Depends(require_platform_permission("platform.user.deactivate"))],
)
async def deactivate_user(
    user_id: uuid.UUID,
    current_user: CurrentInternalUser,
    session: DBSession,
    payload: DeactivateRequest = DeactivateRequest(),
) -> UserRow:
    """Deactivate user account and write audit log."""
    user = await session.get(User, user_id)
    if not user:
        raise ResourceNotFoundException("User not found")

    if user.id == current_user.id:
        raise ConflictException("Cannot deactivate your own account.")

    if user.is_admin:
        roles = await resolve_platform_roles(session, current_user.id)
        perms = await get_permissions_for_roles(session, roles)
        if "platform.staff.manage" not in perms:
            raise APIException(
                status_code=403,
                code="PERMISSION_DENIED",
                message="Requires platform.staff.manage to deactivate staff members.",
            )

    if not user.is_active:
        raise ConflictException("User is already inactive.")

    user.is_active = False

    audit = StaffAuditLog(
        staff_user_id=current_user.id,
        action="user.deactivate",
        target_type="user",
        target_id=str(user.id),
        detail=payload.reason,
    )
    session.add(audit)
    await session.flush()
    await session.commit()

    org_count = (
        await session.scalar(
            select(func.count(Membership.id)).where(
                Membership.user_id == user.id, Membership.status == "active"
            )
        )
    ) or 0

    return UserRow(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        is_active=user.is_active,
        is_staff=user.is_admin,
        org_count=org_count,
        created_at=user.created_at,
    )


@router.post(
    "/users/{user_id}/reactivate",
    dependencies=[Depends(require_platform_permission("platform.user.deactivate"))],
)
async def reactivate_user(
    user_id: uuid.UUID,
    current_user: CurrentInternalUser,
    session: DBSession,
) -> UserRow:
    """Reactivate a deactivated user account and write audit log."""
    user = await session.get(User, user_id)
    if not user:
        raise ResourceNotFoundException("User not found")

    if user.is_admin:
        roles = await resolve_platform_roles(session, current_user.id)
        perms = await get_permissions_for_roles(session, roles)
        if "platform.staff.manage" not in perms:
            raise APIException(
                status_code=403,
                code="PERMISSION_DENIED",
                message="Requires platform.staff.manage to reactivate staff members.",
            )

    if user.is_active:
        raise ConflictException("User is already active.")

    user.is_active = True

    audit = StaffAuditLog(
        staff_user_id=current_user.id,
        action="user.reactivate",
        target_type="user",
        target_id=str(user.id),
        detail=None,
    )
    session.add(audit)
    await session.flush()
    await session.commit()

    org_count = (
        await session.scalar(
            select(func.count(Membership.id)).where(
                Membership.user_id == user.id, Membership.status == "active"
            )
        )
    ) or 0

    return UserRow(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        is_active=user.is_active,
        is_staff=user.is_admin,
        org_count=org_count,
        created_at=user.created_at,
    )
