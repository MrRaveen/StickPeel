from __future__ import annotations

import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text, types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.membership import Membership
    from app.models.organization import Organization
    from app.models.team import Team


class Plan(IdMixin, TimestampMixin, Base):
    __tablename__ = "plans"
    __table_args__ = (
        UniqueConstraint("member_id", "org_id", "week_start_date", name="uq_plans_member_org_week"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        types.Uuid, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True
    )
    week_start_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="draft"
    )  # 'draft', 'submitted', 'approved', 'done'

    # Review, approval and lifecycle fields
    lead_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    returned_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        types.Uuid, ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True
    )
    main_shipped: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Relationships
    organization: Mapped[Organization] = relationship("Organization", back_populates="plans")
    member: Mapped[Membership] = relationship("Membership", back_populates="plans", foreign_keys=[member_id])
    approved_by: Mapped[Membership | None] = relationship("Membership", foreign_keys=[approved_by_member_id])
    team: Mapped[Team | None] = relationship("Team", back_populates="plans")
    tasks: Mapped[list[PlanTask]] = relationship(
        "PlanTask", back_populates="plan", cascade="all, delete-orphan", order_by="PlanTask.order_index"
    )


class PlanTask(IdMixin, TimestampMixin, Base):
    __tablename__ = "plan_tasks"
    __table_args__ = (
        Index(
            "uq_plan_tasks_one_main_per_plan",
            "plan_id",
            unique=True,
            postgresql_where=text("task_type = 'main'"),
        ),
    )

    plan_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("plans.id", ondelete="CASCADE"), nullable=False
    )
    task_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # 'main', 'sub', 'go_to_market'
    why_it_matters: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="pending"
    )  # 'pending', 'done'
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationships
    plan: Mapped[Plan] = relationship("Plan", back_populates="tasks")
