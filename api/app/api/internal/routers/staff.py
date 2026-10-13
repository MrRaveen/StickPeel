from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import delete, func, or_, select

from app.api.internal.access import CurrentInternalUser
from app.api.internal.schemas import (
    StaffCreateRequest,
    StaffDetailResponse,
    StaffListResponse,
    StaffRow,
    StaffUpdateRequest,
)
from app.database import DBSession
from app.exceptions import ConflictException, ResourceNotFoundException
from app.models import PlatformMember, Role, StaffAuditLog, User
from app.rbac import get_permissions_for_roles, require_platform_permission
from app.security import hash_password

router = APIRouter(
    prefix="/staff",
    tags=["staff"],
    dependencies=[Depends(require_platform_permission("platform.staff.manage"))],
)


@router.get("")
async def list_staff(
    session: DBSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None),
    role: str | None = Query(None),
    is_active: bool | None = Query(None),
) -> StaffListResponse:
    """List platform staff members with roles and statuses."""
    stmt = (
        select(User, Role.name)
        .join(PlatformMember, PlatformMember.user_id == User.id)
        .join(Role, Role.id == PlatformMember.role_id)
    )

    if q:
        filter_pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                User.email.ilike(filter_pattern),
                User.first_name.ilike(filter_pattern),
                User.last_name.ilike(filter_pattern),
            )
        )
    if role:
        stmt = stmt.where(Role.name == role)
    if is_active is not None:
        stmt = stmt.where(User.is_active == is_active)

    count_stmt = (
        select(func.count(PlatformMember.id))
        .join(User, User.id == PlatformMember.user_id)
        .join(Role, Role.id == PlatformMember.role_id)
    )
    if q:
        filter_pattern = f"%{q}%"
        count_stmt = count_stmt.where(
            or_(
                User.email.ilike(filter_pattern),
                User.first_name.ilike(filter_pattern),
                User.last_name.ilike(filter_pattern),
            )
        )
    if role:
        count_stmt = count_stmt.where(Role.name == role)
    if is_active is not None:
        count_stmt = count_stmt.where(User.is_active == is_active)

    total = (await session.scalar(count_stmt)) or 0

    offset = (page - 1) * page_size
    stmt = stmt.order_by(User.created_at.desc()).offset(offset).limit(page_size)

    rows = (await session.execute(stmt)).all()

    items = [
        StaffRow(
            user_id=u.id,
            email=u.email,
            first_name=u.first_name,
            last_name=u.last_name,
            role=role_name,
            is_active=u.is_active,
            created_at=u.created_at,
        )
        for u, role_name in rows
    ]

    return StaffListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_staff(
    current_user: CurrentInternalUser,
    session: DBSession,
    data: StaffCreateRequest,
) -> StaffRow:
    """Create a new staff member and assign a platform role."""
    role = (
        await session.execute(
            select(Role).where(Role.name == data.role_name, Role.scope == "platform")
        )
    ).scalar_one_or_none()

    if not role:
        role = Role(name=data.role_name, scope="platform", is_sys=True)
        session.add(role)
        await session.flush()

    existing_user = (
        await session.execute(select(User).where(User.email == data.email.lower()))
    ).scalar_one_or_none()

    if existing_user:
        raise ConflictException("User with this email already exists.")

    user = User(
        first_name=data.first_name,
        last_name=data.last_name,
        email=data.email.lower(),
        password=hash_password(data.password),
        is_admin=True,
        is_active=True,
    )
    session.add(user)
    await session.flush()

    pm = PlatformMember(user_id=user.id, role_id=role.id)
    session.add(pm)

    audit = StaffAuditLog(
        staff_user_id=current_user.id,
        action="staff.create",
        target_type="user",
        target_id=str(user.id),
        detail=f"Assigned platform role: {role.name}",
    )
    session.add(audit)
    await session.flush()
    await session.commit()

    return StaffRow(
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=role.name,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.get("/{user_id}")
async def get_staff_member(
    user_id: UUID,
    session: DBSession,
) -> StaffDetailResponse:
    """Get staff member details with assigned permissions."""
    row = (
        await session.execute(
            select(User, Role)
            .join(PlatformMember, PlatformMember.user_id == User.id)
            .join(Role, Role.id == PlatformMember.role_id)
            .where(User.id == user_id)
        )
    ).first()

    if not row:
        raise ResourceNotFoundException("Staff member not found")

    user, role = row
    perms = await get_permissions_for_roles(session, [role.id])

    return StaffDetailResponse(
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=role.name,
        is_active=user.is_active,
        created_at=user.created_at,
        permissions=sorted(list(perms)),
    )


@router.patch("/{user_id}")
async def update_staff_member(
    user_id: UUID,
    current_user: CurrentInternalUser,
    session: DBSession,
    data: StaffUpdateRequest,
) -> StaffRow:
    """Update staff member profile or role."""
    row = (
        await session.execute(
            select(User, Role, PlatformMember)
            .join(PlatformMember, PlatformMember.user_id == User.id)
            .join(Role, Role.id == PlatformMember.role_id)
            .where(User.id == user_id)
        )
    ).first()

    if not row:
        raise ResourceNotFoundException("Staff member not found")

    user, current_role, pm = row

    if user_id == current_user.id and data.role_name is not None and data.role_name != current_role.name:
        raise ConflictException("Cannot change your own platform role.")

    if current_role.name == "super_admin" and data.role_name is not None and data.role_name != "super_admin":
        other_admins = (
            await session.scalar(
                select(func.count(PlatformMember.id))
                .join(Role, Role.id == PlatformMember.role_id)
                .join(User, User.id == PlatformMember.user_id)
                .where(
                    Role.name == "super_admin",
                    Role.scope == "platform",
                    User.id != user_id,
                    User.is_active == True,
                )
            )
        ) or 0
        if other_admins < 1:
            raise ConflictException("Cannot demote the last active super_admin.")

    updated_fields: list[str] = []
    if data.first_name is not None:
        user.first_name = data.first_name
        updated_fields.append("first_name")
    if data.last_name is not None:
        user.last_name = data.last_name
        updated_fields.append("last_name")

    new_role_name = current_role.name
    if data.role_name is not None and data.role_name != current_role.name:
        role = (
            await session.execute(
                select(Role).where(Role.name == data.role_name, Role.scope == "platform")
            )
        ).scalar_one_or_none()
        if not role:
            role = Role(name=data.role_name, scope="platform", is_sys=True)
            session.add(role)
            await session.flush()

        # Role change replaces the row, so each staff user always has exactly one role
        await session.execute(delete(PlatformMember).where(PlatformMember.user_id == user.id))
        session.add(PlatformMember(user_id=user.id, role_id=role.id))
        new_role_name = role.name
        updated_fields.append(f"role={role.name}")

    audit = StaffAuditLog(
        staff_user_id=current_user.id,
        action="staff.update",
        target_type="user",
        target_id=str(user.id),
        detail=f"Updated: {', '.join(updated_fields)}" if updated_fields else None,
    )
    session.add(audit)
    await session.flush()
    await session.commit()

    return StaffRow(
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=new_role_name,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_staff_member(
    user_id: UUID,
    current_user: CurrentInternalUser,
    session: DBSession,
) -> Response:
    """Remove staff member privileges and platform role without deleting user record."""
    row = (
        await session.execute(
            select(User, Role.name)
            .join(PlatformMember, PlatformMember.user_id == User.id)
            .join(Role, Role.id == PlatformMember.role_id)
            .where(User.id == user_id)
        )
    ).first()

    if not row:
        raise ResourceNotFoundException("Staff member not found")

    user, role_name = row

    if user_id == current_user.id:
        raise ConflictException("Cannot remove yourself from platform staff.")

    if role_name == "super_admin":
        other_admins = (
            await session.scalar(
                select(func.count(PlatformMember.id))
                .join(Role, Role.id == PlatformMember.role_id)
                .join(User, User.id == PlatformMember.user_id)
                .where(
                    Role.name == "super_admin",
                    Role.scope == "platform",
                    User.id != user_id,
                    User.is_active == True,
                )
            )
        ) or 0
        if other_admins < 1:
            raise ConflictException("Cannot remove the last active super_admin.")

    await session.execute(delete(PlatformMember).where(PlatformMember.user_id == user_id))
    user.is_admin = False

    audit = StaffAuditLog(
        staff_user_id=current_user.id,
        action="staff.remove",
        target_type="user",
        target_id=str(user_id),
        detail="Removed platform staff privileges",
    )
    session.add(audit)
    await session.flush()
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
