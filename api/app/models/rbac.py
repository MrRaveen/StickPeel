from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.platform_member import PlatformMember


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )


class Permission(IdMixin, TimestampMixin, Base):
    __tablename__ = "permissions"

    permission_code: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False
    )

    # Relationships
    roles = relationship(
        "Role", secondary="role_permissions", back_populates="permissions"
    )


class Role(IdMixin, TimestampMixin, Base):
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    scope: Mapped[str] = mapped_column(String(50), nullable=False)  # 'org', 'team', 'platform'
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        types.Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    is_sys: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Relationships
    organization: Mapped[Organization | None] = relationship("Organization", back_populates="roles")
    permissions = relationship(
        "Permission", secondary="role_permissions", back_populates="roles"
    )
    memberships = relationship("Membership", back_populates="role")
    platform_members: Mapped[list[PlatformMember]] = relationship(
        "PlatformMember", back_populates="role", cascade="all, delete-orphan"
    )
