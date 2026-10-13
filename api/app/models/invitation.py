from __future__ import annotations

import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, text, types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.rbac import Role
    from app.models.user import User


class Invitation(IdMixin, TimestampMixin, Base):
    __tablename__ = "invitations"

    org_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    link: Mapped[str] = mapped_column(String(1024), nullable=False)
    role_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("roles.id"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("users.id"), nullable=False
    )
    active_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="pending"
    )  # 'cancelled', 'pending', 'accepted'
    expires_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    accepted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        types.Uuid, ForeignKey("users.id"), nullable=True
    )
    accepted_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_invitations_org_active_status", "org_id", "active_status"),
        Index(
            "uq_invitations_org_email_pending",
            "org_id",
            "email",
            unique=True,
            postgresql_where=text("active_status = 'pending'"),
        ),
    )

    # Relationships
    organization: Mapped[Organization] = relationship("Organization", back_populates="invitations")
    role: Mapped[Role] = relationship("Role")
    creator: Mapped[User] = relationship("User", foreign_keys=[created_by])
    accepted_by: Mapped[User | None] = relationship("User", foreign_keys=[accepted_by_user_id])
