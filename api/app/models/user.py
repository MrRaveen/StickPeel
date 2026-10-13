from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.membership import Membership
    from app.models.platform_member import PlatformMember


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"

    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    password_hash: Mapped[str | None] = mapped_column(
        "password", String(128), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Relationships
    memberships: Mapped[list[Membership]] = relationship(
        "Membership", back_populates="user", cascade="all, delete-orphan"
    )
    platform_memberships: Mapped[list[PlatformMember]] = relationship(
        "PlatformMember", back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def password(self) -> str | None:
        return self.password_hash

    @password.setter
    def password(self, value: str | None) -> None:
        self.password_hash = value
