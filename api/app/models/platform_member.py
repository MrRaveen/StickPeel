from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, UniqueConstraint, types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.rbac import Role
    from app.models.user import User


class PlatformMember(IdMixin, TimestampMixin, Base):
    __tablename__ = "platform_members"
    __table_args__ = (
        UniqueConstraint("user_id", "role_id", name="uq_platform_members_user_role"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False
    )

    # Relationships
    user: Mapped[User] = relationship("User", back_populates="platform_memberships")
    role: Mapped[Role] = relationship("Role", back_populates="platform_members")
