from __future__ import annotations

import datetime
import uuid
from typing import Literal

from pydantic import UUID4, ConfigDict, EmailStr, Field

from app.schemas import DateTime, Model



class AuthRequest(Model):
    email: EmailStr
    password: str


class AuthResponse(Model):
    access_token: str
    user_id: str | None = None
    is_admin: bool | None = None


class CreateAccountRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    first_name: str = Field(..., min_length=1, max_length=255)
    last_name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=1)


class UserResponse(Model):
    id: UUID4
    created_at: DateTime
    updated_at: DateTime | None
    first_name: str | None
    last_name: str | None
    email: str


# ----- Org membership list response -----

class OrgInfoResponse(Model):
    org_id: UUID4
    org_name: str
    address: str | None
    is_suspended: bool
    logo_url: str | None
    role_name: str


class MembershipInfoResponse(Model):
    membership_id: UUID4
    membership_status: str


class OrgMembershipResponse(Model):
    org_info: OrgInfoResponse
    membership: MembershipInfoResponse


# ----- Teams response -----

class TeamLeadResponse(Model):
    membership_id: UUID4
    user_id: UUID4
    first_name: str | None
    last_name: str | None
    email: str


class TeamResponse(Model):
    team_id: UUID4
    team_name: str
    org_id: UUID4
    lead: TeamLeadResponse | None
    member_count: int


# ----- Permissions response -----

class PermissionScopeResponse(Model):
    scope: str
    permission_codes: list[str]


# ----- Shared domain schemas -----

class OrgOut(Model):
    id: UUID4
    name: str
    address: str | None = None
    logo_url: str | None = None
    is_suspended: bool
    created_at: DateTime


class CreateOrgResponse(OrgOut):
    role: str = "owner"
    membership_id: UUID4


class OrgDetailResponse(OrgOut):
    my_role: str


class MemberOut(Model):
    membership_id: UUID4
    user_id: UUID4
    email: str
    first_name: str | None = None
    last_name: str | None = None
    role: str
    status: str
    joined_at: DateTime


class TeamLeadInfo(Model):
    membership_id: UUID4
    first_name: str | None = None
    last_name: str | None = None


class TeamOut(Model):
    id: UUID4
    name: str
    lead: TeamLeadInfo | None = None
    member_count: int = 0


class TeamMemberOut(Model):
    membership_id: UUID4
    first_name: str | None = None
    last_name: str | None = None
    email: str
    team_role: str
    membership_status: str = "active"


class TeamDetailResponse(TeamOut):
    members: list[TeamMemberOut] = []


class MyTeamResponse(Model):
    team: TeamOut
    my_team_role: str
    membership_status: str = "active"
    can_enter: bool = True
    permissions: list[str] = []



class InvitationCreate(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    email: str = Field(..., min_length=3, max_length=254)
    role_name: Literal["admin", "member"]


class InvitationCreatorInfo(Model):
    user_id: UUID4
    name: str


class InvitationOut(Model):
    id: UUID4
    email: str
    role_name: str
    status: Literal["pending", "accepted", "cancelled", "expired"]
    link: str | None = None
    expires_at: DateTime
    created_by: InvitationCreatorInfo
    created_at: DateTime
    accepted_at: DateTime | None = None


class InvitationPublic(Model):
    organization_name: str
    organization_logo_url: str | None = None
    role_name: str
    masked_email: str
    email: str
    expires_at: DateTime


class AcceptOut(Model):
    organization: OrgOut
    role_name: str
    membership_id: UUID4


class InviteOut(Model):
    id: UUID4
    email: str
    role: str
    active_status: str
    link: str
    expires_at: DateTime | None = None
    created_at: DateTime


class TaskIn(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    id: UUID4 | None = None
    task_type: Literal["main", "sub", "go_to_market"]
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    why_it_matters: str | None = None
    order_index: int = 0


class TaskOut(Model):
    id: UUID4
    task_type: str
    title: str
    description: str | None = None
    why_it_matters: str | None = None
    status: str
    order_index: int


class PlanOut(Model):
    id: UUID4
    team_id: UUID4 | None = None
    week_start_date: datetime.date
    status: str
    lead_comment: str | None = None
    returned_at: DateTime | None = None
    submitted_at: DateTime | None = None
    approved_at: DateTime | None = None
    approved_by: UUID4 | None = None
    main_shipped: bool | None = None
    completed_at: DateTime | None = None
    tasks: list[TaskOut] = []
    created_at: DateTime
    updated_at: DateTime | None = None


class PlanSummary(Model):
    id: UUID4
    team_id: UUID4 | None = None
    week_start_date: datetime.date
    status: str
    task_count: int
    done_count: int
    main_shipped: bool | None = None


# ----- Organization request schemas -----

class CreateOrgRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(..., min_length=1, max_length=255)
    address: str | None = None
    logo_url: str | None = None


class UpdateOrgRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=255)
    address: str | None = None
    logo_url: str | None = None


class TransferOwnershipRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    new_owner_member_id: UUID4


class DeleteOrgRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    confirm_name: str


# ----- Member request schemas -----

class UpdateMemberRoleRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid", populate_by_name=True)
    role_id: UUID4 | None = Field(None, alias="roleID")
    role_name: Literal["admin", "member"] | None = None


class UpdateMemberStatusRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    status: Literal["active", "suspended"]


# ----- Team request schemas -----

class CreateTeamRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(..., min_length=1, max_length=255)
    lead_member_id: UUID4 | None = None


class UpdateTeamRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(..., min_length=1, max_length=255)


class AddTeamMemberRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    member_id: UUID4


class UpdateTeamMemberStatusRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    status: Literal["active", "suspended"]


class AssignTeamLeadRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    member_id: UUID4


# ----- Plan request schemas -----

class CreatePlanRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    team_id: UUID4
    week_start_date: datetime.date
    tasks: list[TaskIn] = []


class UpdatePlanRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    team_id: UUID4 | None = None
    tasks: list[TaskIn] = []


class DeletePlanRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid", populate_by_name=True)
    new_plan_ID_approving: UUID4 | None = Field(None, alias="new_plan_id_approving")


class UpdateTaskStatusRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    status: Literal["pending", "done"]


class CompletePlanRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    main_shipped: bool


# ----- Team Lead Plan Review schemas -----

class AuthorInfo(Model):
    member_id: UUID4
    first_name: str | None = None
    last_name: str | None = None


class TeamPlanSummaryOut(Model):
    id: UUID4
    team_id: UUID4 | None = None
    week_start_date: datetime.date
    status: str
    task_count: int
    done_count: int
    main_shipped: bool | None = None
    author: AuthorInfo


class TeamPlanOut(PlanOut):
    author: AuthorInfo


class ReturnPlanRequest(Model):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    comment: str = Field(..., min_length=1, max_length=2000)


class TeamWeekMember(Model):
    member_id: UUID4
    first_name: str | None = None
    last_name: str | None = None
    plan_id: UUID4 | None = None
    status: str
    tasks_total: int = 0
    tasks_done: int = 0
    main_shipped: bool | None = None


class TeamWeekTotals(Model):
    members: int
    no_plan: int
    submitted: int
    approved: int
    done: int


class TeamWeekViewOut(Model):
    week_start_date: datetime.date
    members: list[TeamWeekMember]
    totals: TeamWeekTotals


class TeamHistoryWeekSummary(Model):
    week_start_date: datetime.date
    members: int
    submitted: int
    approved: int
    done: int
    shipped: int
    tasks_total: int
    tasks_done: int





