"""Customer AI endpoints: plan review, plan drafting, and AI feature status."""

from __future__ import annotations

import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.ai.schemas import (
    AIStatusResponse,
    DraftPlanRequest,
    DraftPlanResponse,
    ReviewPlanResponse,
)
from app.ai.service import draft_plan, get_ai_status, review_plan
from app.api.app.access import CurrentUser
from app.database import DBSession
from app.exceptions import APIException
from app.models import Membership, Plan
from app.rbac import RequirePermission

router = APIRouter(tags=["ai"])


@router.get(
    "/orgs/{org_id}/ai/status",
    dependencies=[Depends(RequirePermission("plan.ai_use", allowed_scopes="org"))],
)
async def get_org_ai_status(
    org_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> AIStatusResponse:
    """Return AI availability, configured limits, and remaining requests."""
    return await get_ai_status(session, org_id, current_user.id)


@router.post(
    "/orgs/{org_id}/plans/draft",
    dependencies=[Depends(RequirePermission("plan.ai_use", allowed_scopes="org"))],
)
async def create_plan_draft_from_notes(
    org_id: UUID,
    body: DraftPlanRequest,
    current_user: CurrentUser,
    session: DBSession,
) -> DraftPlanResponse:
    """Generate a structured draft plan from unformatted engineer notes (saves nothing)."""
    result = await draft_plan(
        session=session,
        org_id=org_id,
        user_id=current_user.id,
        notes=body.notes,
        week_start_date=body.week_start_date,
    )

    if not result.success:
        await session.commit()
        content: dict[str, Any] = {
            "code": result.error_code,
            "message": result.error_message,
        }
        if result.retry_after_seconds:
            content["retry_after_seconds"] = result.retry_after_seconds
        return JSONResponse(status_code=result.status_code, content=content)  # type: ignore

    await session.commit()
    now_iso = datetime.datetime.now(datetime.UTC).isoformat()
    return DraftPlanResponse(
        draft=result.data,
        model=result.model,
        generated_at=now_iso,
    )


@router.post(
    "/orgs/{org_id}/plans/{plan_id}/review",
    dependencies=[Depends(RequirePermission("plan.ai_use", allowed_scopes="org"))],
)
async def review_existing_plan(
    org_id: UUID,
    plan_id: UUID,
    current_user: CurrentUser,
    session: DBSession,
) -> ReviewPlanResponse:
    """Review a draft plan from the database and return findings (author only, saves nothing)."""
    # 1. Author only: verify caller is an active member in this org
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.org_id == org_id,
            Membership.status == "active",
        )
    )
    if membership is None:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found.",
        )

    # 2. Load plan by (id, org_id, member_id). If other member or org: return 404
    plan = await session.scalar(
        select(Plan)
        .options(selectinload(Plan.tasks))
        .where(
            Plan.id == plan_id,
            Plan.org_id == org_id,
            Plan.member_id == membership.id,
        )
    )
    if plan is None:
        raise APIException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PLAN_NOT_FOUND",
            message="Plan not found.",
        )

    # 3. Plan must be draft
    if plan.status != "draft":
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="plan_not_draft",
            message="Only draft plans can be reviewed.",
        )

    # 4. Plan with no tasks returns 409 plan_empty
    if not plan.tasks:
        raise APIException(
            status_code=status.HTTP_409_CONFLICT,
            code="plan_empty",
            message="Plan has no tasks to review.",
        )

    result = await review_plan(
        session=session,
        org_id=org_id,
        user_id=current_user.id,
        plan=plan,
    )

    if not result.success:
        await session.commit()
        content: dict[str, Any] = {
            "code": result.error_code,
            "message": result.error_message,
        }
        if result.retry_after_seconds:
            content["retry_after_seconds"] = result.retry_after_seconds
        return JSONResponse(status_code=result.status_code, content=content)  # type: ignore

    await session.commit()
    now_iso = datetime.datetime.now(datetime.UTC).isoformat()
    updated_at_iso = plan.updated_at.isoformat() if plan.updated_at else None
    return ReviewPlanResponse(
        review=result.data,
        plan_updated_at=updated_at_iso,
        model=result.model,
        generated_at=now_iso,
    )
