from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Plan Review Schemas
# ---------------------------------------------------------------------------


class ReviewTaskInput(BaseModel):
    ref: str
    task_type: Literal["main", "sub", "go_to_market"]
    title: str
    description: str | None = None
    why_it_matters: str | None = None


class ReviewPlanInput(BaseModel):
    week_start_date: str
    tasks: list[ReviewTaskInput]


class Finding(BaseModel):
    task_ref: str
    issue_type: Literal[
        "not_checkable", "missing_why", "missing_gtm", "scope_too_big", "other"
    ]
    severity: Literal["blocker", "suggestion"]
    problem: str
    action: Literal["rewrite", "add"]
    target_field: Literal["title", "description", "why_it_matters"] | None = None
    suggested_text: str
    suggested_task_type: Literal["sub", "go_to_market"] | None = None


class PlanReview(BaseModel):
    verdict: Literal["approve", "adjust"]
    summary: str
    findings: list[Finding] = Field(default_factory=list, max_length=10)


@dataclass
class ReviewDeps:
    task_ids: set[str]
    tasks_by_id: dict[str, ReviewTaskInput]
    main_task_id: str | None


# ---------------------------------------------------------------------------
# Plan Draft Schemas
# ---------------------------------------------------------------------------


class DraftTask(BaseModel):
    title: str = Field(max_length=255)
    description: str | None = None


class DraftMainTask(BaseModel):
    title: str = Field(max_length=255)
    why_it_matters: str = Field(min_length=1)
    description: str | None = None


class PlanDraft(BaseModel):
    main_task: DraftMainTask
    sub_goals: list[DraftTask] = Field(default_factory=list, max_length=5)
    go_to_market: list[DraftTask] = Field(default_factory=list, max_length=4)
    unclear: list[str] = Field(default_factory=list, max_length=5)


# ---------------------------------------------------------------------------
# API Request / Response Schemas
# ---------------------------------------------------------------------------


class DraftPlanRequest(BaseModel):
    notes: str = Field(min_length=1, max_length=4000)
    week_start_date: str | None = None


class ReviewPlanResponse(BaseModel):
    review: PlanReview
    plan_updated_at: str | None = None
    model: str
    generated_at: str


class DraftPlanResponse(BaseModel):
    draft: PlanDraft
    model: str
    generated_at: str


class AIStatusLimits(BaseModel):
    per_user_per_min: int
    per_org_per_min: int


class AIStatusRemaining(BaseModel):
    user: int
    org: int


class AIStatusResponse(BaseModel):
    available: bool
    reason: str | None = None
    limits: AIStatusLimits
    remaining: AIStatusRemaining
