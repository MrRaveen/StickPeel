from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, UniqueConstraint, types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.plan import Plan
    from app.models.rbac import Role
    from app.models.team import Team, TeamMember
    from app.models.user import User


class Membership(IdMixin, TimestampMixin, Base):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "org_id", name="uq_memberships_user_org"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("roles.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="active"
    )  # 'active', 'suspended','removed'

    # Relationships
    user: Mapped[User] = relationship("User", back_populates="memberships")
    organization: Mapped[Organization] = relationship("Organization", back_populates="memberships")
    role: Mapped[Role] = relationship("Role", back_populates="memberships")
    team_memberships: Mapped[list[TeamMember]] = relationship(
        "TeamMember", back_populates="member", cascade="all, delete-orphan"
    )
    led_teams: Mapped[list[Team]] = relationship(
        "Team", back_populates="lead_member"
    )
    plans: Mapped[list[Plan]] = relationship(
        "Plan",
        back_populates="member",
        cascade="all, delete-orphan",
        foreign_keys="Plan.member_id",
    )
