from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.plan import Plan
    from app.models.user import User


class AICall(IdMixin, TimestampMixin, Base):
    __tablename__ = "ai_calls"
    __table_args__ = (
        Index("ix_ai_calls_org_id_created_at", "org_id", "created_at"),
        Index("ix_ai_calls_org_id_status", "org_id", "status"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        types.Uuid, ForeignKey("plans.id", ondelete="SET NULL"), nullable=True
    )
    feature: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # 'plan_review', 'plan_draft'
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # 'success', 'failed', 'rate_limited', 'timeout', 'invalid_output'
    error_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Relationships
    organization: Mapped[Organization] = relationship("Organization")
    user: Mapped[User] = relationship("User")
    plan: Mapped[Plan | None] = relationship("Plan")
