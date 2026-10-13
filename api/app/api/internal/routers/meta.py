from __future__ import annotations

import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func, select, text

from app.api.internal.access import CurrentInternalUser
from app.api.internal.schemas import (
    AuditListResponse,
    AuditRow,
    InternalAuthRequest,
    InternalAuthResponse,
    InternalRoleResponse,
)
from app.config import settings
from app.database import DBSession
from app.exceptions import APIException
from app.logging import logger
from app.models import PlatformMember, Role, StaffAuditLog, User
from app.rbac import get_permissions_for_roles, require_platform_permission
from app.schemas import HealthCheckResponse
from app.security import (
    JWT_AUDIENCE_INTERNAL,
    generate_jwt_token,
    verify_password,
)

INTERNAL_COOKIE_NAME = "internal_access_token"

router = APIRouter()


@router.get("/health", tags=["meta"])
async def health(session: DBSession, response: Response) -> HealthCheckResponse:
    try:
        await session.execute(text("SELECT 1"))
        return HealthCheckResponse(status="healthy")
    except Exception:
        logger.exception("Internal health check failed")
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthCheckResponse(status="unhealthy")


@router.post("/auth", tags=["auth"])
async def auth(
    auth_request: InternalAuthRequest, session: DBSession, response: Response
) -> InternalAuthResponse:
    """Authenticate platform staff and return permissions and set internal token cookie."""
    result = await session.execute(
        select(User).where(User.email == auth_request.email.lower())
    )
    user = result.scalars().first()

    # Reject if user is missing, inactive, not platform staff, or bad password
    if (
        user is None
        or not user.is_active
        or not user.is_admin
        or user.password is None
        or not verify_password(auth_request.password, user.password)
    ):
        raise APIException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="INVALID_CREDENTIALS",
            message="Incorrect username or password",
        )

    # Must also have a platform_members role
    role_row = (
        await session.execute(
            select(Role)
            .join(PlatformMember, PlatformMember.role_id == Role.id)
            .where(PlatformMember.user_id == user.id)
        )
    ).scalar_one_or_none()

    if role_row is None:
        raise APIException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="INVALID_CREDENTIALS",
            message="Incorrect username or password",
        )

    assigned_perms = await get_permissions_for_roles(session, [role_row.id])

    access_token = generate_jwt_token(
        {"sub": str(user.id), "surface": "internal"},
        audience=JWT_AUDIENCE_INTERNAL,
    )
    response.set_cookie(
        key=INTERNAL_COOKIE_NAME,
        value=f"Bearer {access_token}",
        samesite="lax",
        secure=settings.SECURE_COOKIE,
        httponly=True,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    return InternalAuthResponse(
        user_id=user.id,
        email=user.email,
        role=role_row.name,
        permissions=sorted(list(assigned_perms)),
        access_token=access_token,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, tags=["auth"])
async def logout(response: Response) -> Response:
    """Clear internal auth cookie."""
    response.delete_cookie(INTERNAL_COOKIE_NAME)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get(
    "/roles",
    tags=["roles"],
    dependencies=[Depends(require_platform_permission("platform.staff.manage"))],
)
async def list_roles(session: DBSession) -> list[InternalRoleResponse]:
    """List all platform roles and their permissions for the staff form dropdown."""
    roles = (
        await session.scalars(
            select(Role).where(Role.scope == "platform").order_by(Role.name)
        )
    ).all()

    result: list[InternalRoleResponse] = []
    for role in roles:
        assigned = await get_permissions_for_roles(session, [role.id])
        result.append(
            InternalRoleResponse(
                name=role.name,
                permissions=sorted(list(assigned)),
            )
        )
    return result


@router.get(
    "/audit-logs",
    tags=["audit-logs"],
    dependencies=[Depends(require_platform_permission("platform.audit.view"))],
)
async def list_audit_logs(
    session: DBSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    staff_user_id: UUID | None = Query(None),
    action: str | None = Query(None),
    target_type: str | None = Query(None),
    from_date: datetime.datetime | None = Query(None, alias="from"),
    to_date: datetime.datetime | None = Query(None, alias="to"),
) -> AuditListResponse:
    """List platform audit logs with pagination and optional filters."""
    stmt = (
        select(StaffAuditLog, User.email)
        .join(User, User.id == StaffAuditLog.staff_user_id)
    )

    if staff_user_id is not None:
        stmt = stmt.where(StaffAuditLog.staff_user_id == staff_user_id)
    if action is not None:
        stmt = stmt.where(StaffAuditLog.action == action)
    if target_type is not None:
        stmt = stmt.where(StaffAuditLog.target_type == target_type)
    if from_date is not None:
        stmt = stmt.where(StaffAuditLog.created_at >= from_date)
    if to_date is not None:
        stmt = stmt.where(StaffAuditLog.created_at <= to_date)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await session.scalar(count_stmt)) or 0

    offset = (page - 1) * page_size
    stmt = stmt.order_by(StaffAuditLog.created_at.desc()).offset(offset).limit(page_size)

    rows = (await session.execute(stmt)).all()

    items = [
        AuditRow(
            id=log.id,
            staff_user_id=log.staff_user_id,
            staff_email=user_email,
            action=log.action,
            target_type=log.target_type,
            target_id=log.target_id,
            detail=log.detail,
            created_at=log.created_at,
        )
        for log, user_email in rows
    ]

    return AuditListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )
