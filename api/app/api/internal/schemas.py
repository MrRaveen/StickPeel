from __future__ import annotations

from typing import Literal

from pydantic import UUID4, ConfigDict, EmailStr, Field

from app.schemas import DateTime, Model


# ---------------------------------------------------------------------------
# Auth / Identity
# ---------------------------------------------------------------------------


class InternalAuthRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    email: EmailStr
    password: str


class InternalAuthResponse(Model):
    user_id: UUID4
    email: str
    role: str
    permissions: list[str]
    access_token: str | None = None


class InternalSelfResponse(Model):
    user_id: UUID4
    email: str
    first_name: str
    last_name: str
    role: str
    permissions: list[str]


class InternalRoleResponse(Model):
    name: str
    permissions: list[str]


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------


class OrgRow(Model):
    id: UUID4
    name: str
    is_suspended: bool
    member_count: int = 0
    team_count: int = 0
    plan_count: int = 0
    last_active_at: DateTime | None = None
    created_at: DateTime


class OrgOwner(Model):
    user_id: UUID4
    name: str
    email: str


class PlansByStatus(Model):
    draft: int = 0
    submitted: int = 0
    approved: int = 0
    done: int = 0


class AiCalls30d(Model):
    total: int = 0
    failed: int = 0
    rate_limited: int = 0


class OrgDetail(OrgRow):
    address: str | None = None
    logo_url: str | None = None
    owners: list[OrgOwner] = []
    plans_by_status: PlansByStatus = PlansByStatus()
    ai_calls_30d: AiCalls30d = AiCalls30d()


class OrgListResponse(Model):
    items: list[OrgRow]
    total: int
    page: int = 1
    page_size: int = 20


class SuspendRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    reason: str | None = Field(default=None, max_length=500)


class OrgMemberRow(Model):
    membership_id: UUID4
    user_id: UUID4
    email: str
    name: str
    role: str
    status: str
    joined_at: DateTime


class OrgMemberListResponse(Model):
    items: list[OrgMemberRow]
    total: int
    page: int = 1
    page_size: int = 20


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class UserRow(Model):
    id: UUID4
    email: str
    first_name: str
    last_name: str
    is_active: bool
    is_staff: bool
    org_count: int = 0
    created_at: DateTime


class UserMembership(Model):
    org_id: UUID4
    org_name: str
    org_suspended: bool
    role: str
    status: str


class UserDetail(UserRow):
    memberships: list[UserMembership] = []


class UserListResponse(Model):
    items: list[UserRow]
    total: int
    page: int = 1
    page_size: int = 20


class DeactivateRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    reason: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------


class StaffRow(Model):
    user_id: UUID4
    email: str
    first_name: str
    last_name: str
    role: str
    is_active: bool
    created_at: DateTime


class StaffDetailResponse(StaffRow):
    permissions: list[str] = []


class StaffListResponse(Model):
    items: list[StaffRow]
    total: int
    page: int = 1
    page_size: int = 20


class StaffCreateRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8)
    role_name: Literal["super_admin", "operations", "support", "viewer"]


class StaffUpdateRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    role_name: Literal["super_admin", "operations", "support", "viewer"] | None = None


# ---------------------------------------------------------------------------
# Audit Logs
# ---------------------------------------------------------------------------


class AuditRow(Model):
    id: UUID4
    staff_user_id: UUID4
    staff_email: str
    action: str
    target_type: str
    target_id: str
    detail: str | None = None
    created_at: DateTime


class AuditListResponse(Model):
    items: list[AuditRow]
    total: int
    page: int = 1
    page_size: int = 20


# ---------------------------------------------------------------------------
# AI Usage
# ---------------------------------------------------------------------------


class AiUsageRow(Model):
    org_id: UUID4
    org_name: str
    total_calls: int = 0
    success: int = 0
    failed: int = 0
    rate_limited: int = 0
    timeout: int = 0
    invalid_output: int = 0
    last_call_at: DateTime | None = None


class AiUsageTotals(Model):
    total_calls: int = 0
    success: int = 0
    failed: int = 0
    rate_limited: int = 0
    timeout: int = 0
    invalid_output: int = 0


class AiUsageListResponse(Model):
    items: list[AiUsageRow]
    total: int
    page: int = 1
    page_size: int = 20
    totals: AiUsageTotals = AiUsageTotals()


# ---------------------------------------------------------------------------
# Backward Compatibility Aliases
# ---------------------------------------------------------------------------

AuthRequest = InternalAuthRequest
AuthResponse = InternalAuthResponse
InternalUserResponse = UserRow
UsersListResponse = UserListResponse
InternalOrgResponse = OrgRow
InternalOrgsListResponse = OrgListResponse
AIUsageItemResponse = AiUsageRow
AIUsageResponse = AiUsageListResponse
StaffMemberResponse = StaffRow
