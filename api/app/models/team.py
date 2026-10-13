from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, UniqueConstraint, types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.membership import Membership
    from app.models.organization import Organization
    from app.models.plan import Plan
    from app.models.rbac import Role


class Team(IdMixin, TimestampMixin, Base):
    __tablename__ = "teams"

    org_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    lead_member_id: Mapped[uuid.UUID | None] = mapped_column(
        types.Uuid, ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization: Mapped[Organization] = relationship("Organization", back_populates="teams")
    lead_member: Mapped[Membership | None] = relationship(
        "Membership", back_populates="led_teams", foreign_keys=[lead_member_id]
    )
    members: Mapped[list[TeamMember]] = relationship(
        "TeamMember", back_populates="team", cascade="all, delete-orphan"
    )
    plans: Mapped[list[Plan]] = relationship(
        "Plan", back_populates="team"
    )


class TeamMember(IdMixin, TimestampMixin, Base):
    __tablename__ = "team_members"
    __table_args__ = (
        UniqueConstraint("team_id", "member_id", name="uq_team_members_team_member"),
    )

    team_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("roles.id"), nullable=False
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    membership_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="active"
    )  # 'active', 'suspended', 'removed'

    @property
    def team_membership_status(self) -> str:
        return self.membership_status

    @team_membership_status.setter
    def team_membership_status(self, value: str) -> None:
        self.membership_status = value

    # Relationships
    team: Mapped[Team] = relationship("Team", back_populates="members")
    member: Mapped[Membership] = relationship("Membership", back_populates="team_memberships")
    role: Mapped[Role] = relationship("Role")
    organization: Mapped[Organization] = relationship("Organization")
