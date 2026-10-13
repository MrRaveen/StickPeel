"""Dynamic RBAC Strategy Pattern — scope resolvers + RequirePermission dependency.

Usage:
    @router.get("/orgs/{org_id}/plans")
    async def list_plans(
        authorized: bool = Depends(RequirePermission("org.view", allowed_scopes="org")),
    ): ...

    @router.get("/internal/orgs")
    async def list_internal_orgs(
        authorized: bool = Depends(RequirePermission("platform.org.view", allowed_scopes="platform")),
    ): ...
"""
from __future__ import annotations

import datetime
from uuid import UUID

from fastapi import Depends, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.app.access import get_current_http_user
from app.api.internal.access import get_current_internal_user
from app.database import get_db
from app.exceptions import APIException
from app.models import Membership, Organization, Permission, PlatformMember, RolePermission, Team, TeamMember
from app.models import User

# ---------------------------------------------------------------------------
# Scope resolvers
# ---------------------------------------------------------------------------


async def resolve_platform_roles(
    session: AsyncSession, user_id: UUID, **kwargs
) -> list[UUID]:
    """Return all platform role_ids for user_id."""
    res = await session.scalars(
        select(PlatformMember.role_id).where(PlatformMember.user_id == user_id)
    )
    return list(res.all())


async def resolve_platform_role(
    session: AsyncSession, user_id: UUID, **kwargs
) -> UUID | None:
    """Return the primary platform role_id for user_id, or None if not a platform member."""
    roles = await resolve_platform_roles(session, user_id, **kwargs)
    return roles[0] if roles else None


async def resolve_org_role(
    session: AsyncSession,
    user_id: UUID,
    org_id: str | None = None,
    **kwargs,
) -> UUID | None:
    """Return the org role_id for (user_id, org_id), verifying membership and org status.

    Rejects suspended organizations with 403.
    Updates Organization.last_active_at at most once every 5 minutes.
    """
    if not org_id:
        return None

    org_uuid = UUID(org_id)

    # Load organization to verify suspension status and last active time
    org = await session.get(Organization, org_uuid)
    if not org:
        return None

    if org.is_suspended:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ORG_SUSPENDED",
            message="Organization is suspended.",
        )

    # Verify membership and its status
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.org_id == org_uuid,
        )
    )
    if not membership:
        return None

    if membership.status == "suspended":
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="MEMBERSHIP_SUSPENDED",
            message="Membership in this organization is suspended.",
        )

    if membership.status != "active":
        return None

    role_id = membership.role_id

    if role_id is not None:
        # Update last_active_at at most once every 5 minutes
        now = datetime.datetime.now(datetime.timezone.utc)
        if org.last_active_at is None or (now - org.last_active_at).total_seconds() > 300:
            org.last_active_at = now
            await session.flush()

    return role_id


async def resolve_team_role(
    session: AsyncSession,
    user_id: UUID,
    team_id: str | None = None,
    org_id: str | None = None,
    **kwargs,
) -> UUID | None:
    """Return the team role_id for (user_id, team_id) via Membership -> TeamMember."""
    if not team_id:
        return None

    team_uuid = UUID(team_id)
    team = await session.get(Team, team_uuid)
    if not team:
        return None

    target_org_id = UUID(org_id) if org_id else team.org_id
    org = await session.get(Organization, target_org_id)
    if org and org.is_suspended:
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ORG_SUSPENDED",
            message="Organization is suspended.",
        )

    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.org_id == target_org_id,
        )
    )
    if not membership:
        return None

    if membership.status == "suspended":
        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="MEMBERSHIP_SUSPENDED",
            message="Membership in this organization is suspended.",
        )

    if membership.status != "active":
        return None

    return await session.scalar(
        select(TeamMember.role_id).where(
            TeamMember.member_id == membership.id,
            TeamMember.team_id == team_uuid,
            TeamMember.membership_status == "active",
        )
    )



# Dispatcher: string scope -> resolver function
SCOPE_RESOLVERS = {
    "platform": resolve_platform_role,
    "org": resolve_org_role,
    "team": resolve_team_role,
}

# ---------------------------------------------------------------------------
# Helper: load all permission codes for a set of role_ids
# ---------------------------------------------------------------------------


async def get_permissions_for_roles(
    session: AsyncSession, role_ids: list[UUID]
) -> set[str]:
    """Return the set of permission codes granted to all roles in *role_ids*."""
    if not role_ids:
        return set()
    rows = await session.execute(
        select(Permission.permission_code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role_id.in_(role_ids))
    )
    return {row[0] for row in rows}


# ---------------------------------------------------------------------------
# AppRequirePermission dependency (for app surface: org, team)
# ---------------------------------------------------------------------------


class AppRequirePermission:
    """FastAPI dependency enforcing RBAC across app scopes (org, team)."""

    def __init__(
        self,
        required_permission: str,
        allowed_scopes: str | list[str],
    ) -> None:
        self.required_permission = required_permission
        self.allowed_scopes = (
            [allowed_scopes] if isinstance(allowed_scopes, str) else allowed_scopes
        )

    async def __call__(
        self,
        request: Request,
        current_user: User = Depends(get_current_http_user),
        session: AsyncSession = Depends(get_db),
    ) -> bool:
        path_params: dict = dict(request.path_params)

        role_ids: list[UUID] = []
        for scope in self.allowed_scopes:
            resolver = SCOPE_RESOLVERS.get(scope)
            if resolver is None:
                continue
            role_id = await resolver(session, current_user.id, **path_params)
            if role_id is not None:
                role_ids.append(role_id)

        if not role_ids:
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="NOT_AUTHORIZED",
                message="Not authorized in this scope.",
            )

        assigned = await get_permissions_for_roles(session, role_ids)

        if self.required_permission not in assigned:
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="PERMISSION_DENIED",
                message=f"Missing required permission: {self.required_permission}",
            )

        return True


# ---------------------------------------------------------------------------
# RequirePlatformPermission dependency (for internal surface)
# ---------------------------------------------------------------------------


class RequirePlatformPermission:
    """FastAPI dependency for internal routes enforcing platform RBAC permissions."""

    def __init__(self, required_permission: str) -> None:
        self.required_permission = required_permission

    async def __call__(
        self,
        current_user: User = Depends(get_current_internal_user),
        session: AsyncSession = Depends(get_db),
    ) -> bool:
        role_ids = await resolve_platform_roles(session, current_user.id)
        if not role_ids:
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="NOT_AUTHORIZED",
                message="User has no platform roles assigned.",
            )

        assigned = await get_permissions_for_roles(session, role_ids)
        if self.required_permission not in assigned:
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="PERMISSION_DENIED",
                message=f"Missing required permission: {self.required_permission}",
            )

        return current_user


require_platform_permission = RequirePlatformPermission


# ---------------------------------------------------------------------------
# RequirePermission factory
# ---------------------------------------------------------------------------


class RequirePermission:
    """FastAPI dependency factory that routes to App or Platform permission checks.

    Example::

        Depends(RequirePermission("org.view", allowed_scopes="org"))
        Depends(RequirePermission("platform.org.view", allowed_scopes="platform"))
    """

    def __new__(
        cls,
        required_permission: str,
        allowed_scopes: str | list[str] = "org",
    ):
        scopes = (
            [allowed_scopes] if isinstance(allowed_scopes, str) else allowed_scopes
        )
        if scopes == ["platform"] or (len(scopes) == 1 and scopes[0] == "platform"):
            return RequirePlatformPermission(required_permission)
        return AppRequirePermission(required_permission, allowed_scopes=scopes)


class RequireTeamViewOrOrgManage:
    """FastAPI dependency allowing either team.view (team scope) or team.manage (org scope)."""

    async def __call__(
        self,
        request: Request,
        current_user: User = Depends(get_current_http_user),
        session: AsyncSession = Depends(get_db),
    ) -> bool:
        path_params = dict(request.path_params)
        org_id = path_params.get("org_id")
        team_id = path_params.get("team_id")

        role_ids: list[UUID] = []
        if org_id:
            org_role_id = await resolve_org_role(session, current_user.id, org_id=str(org_id))
            if org_role_id is not None:
                role_ids.append(org_role_id)

        if team_id:
            team_role_id = await resolve_team_role(session, current_user.id, team_id=str(team_id))
            if team_role_id is not None:
                role_ids.append(team_role_id)

        if not role_ids:
            raise APIException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="NOT_AUTHORIZED",
                message="Not authorized in this scope.",
            )

        assigned_perms = await get_permissions_for_roles(session, role_ids)
        if "team.manage" in assigned_perms or "team.view" in assigned_perms:
            return True

        raise APIException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="PERMISSION_DENIED",
            message="Missing required permission: team.view or team.manage",
        )

