from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class StaffAuditLog(IdMixin, TimestampMixin, Base):
    __tablename__ = "staff_audit_logs"

    staff_user_id: Mapped[uuid.UUID] = mapped_column(
        types.Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type: Mapped[str] = mapped_column(String(100), nullable=False)
    target_id: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Relationships
    staff_user: Mapped[User] = relationship("User")
