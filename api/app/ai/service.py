"""AI service: limits, timeout, error mapping, and logging to ai_calls."""

from __future__ import annotations

import asyncio
import datetime
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from pydantic_ai.exceptions import ModelHTTPError, UnexpectedModelBehavior
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.agents import drafter_agent, get_default_model, reviewer_agent
from app.ai.schemas import (
    AIStatusLimits,
    AIStatusRemaining,
    AIStatusResponse,
    ReviewDeps,
    ReviewTaskInput,
)
from app.config import settings
from app.models import AICall, Plan


@dataclass
class AIServiceResult:
    success: bool
    data: Any = None
    model: str = settings.AI_MODEL
    error_code: str | None = None
    error_message: str | None = None
    status_code: int = 200
    retry_after_seconds: int | None = None


def _is_agent_overridden(agent: Any) -> bool:
    """Return True if an override model is active on the agent (e.g. in test suites)."""
    override_var = getattr(agent, "_override_model", None)
    if override_var is not None:
        try:
            return override_var.get() is not None
        except Exception:  # noqa: BLE001
            return False
    return False


async def get_ai_status(
    session: AsyncSession, org_id: UUID, user_id: UUID
) -> AIStatusResponse:
    """Check AI feature availability and remaining rate limits without calling Gemini."""
    has_key = bool(settings.GOOGLE_API_KEY and settings.GOOGLE_API_KEY.strip())
    limits = AIStatusLimits(
        per_user_per_min=settings.AI_LIMIT_USER_PER_MIN,
        per_org_per_min=settings.AI_LIMIT_ORG_PER_MIN,
    )

    if not has_key:
        return AIStatusResponse(
            available=False,
            reason="not_configured",
            limits=limits,
            remaining=AIStatusRemaining(user=0, org=0),
        )

    cutoff = datetime.datetime.now(datetime.UTC) - datetime.timedelta(seconds=60)
    user_calls = (
        await session.scalar(
            select(func.count(AICall.id)).where(
                AICall.org_id == org_id,
                AICall.user_id == user_id,
                AICall.created_at >= cutoff,
                AICall.status != "rate_limited",
            )
        )
        or 0
    )
    org_calls = (
        await session.scalar(
            select(func.count(AICall.id)).where(
                AICall.org_id == org_id,
                AICall.created_at >= cutoff,
                AICall.status != "rate_limited",
            )
        )
        or 0
    )

    return AIStatusResponse(
        available=True,
        reason=None,
        limits=limits,
        remaining=AIStatusRemaining(
            user=max(0, settings.AI_LIMIT_USER_PER_MIN - user_calls),
            org=max(0, settings.AI_LIMIT_ORG_PER_MIN - org_calls),
        ),
    )


async def _check_rate_limit(
    session: AsyncSession, org_id: UUID, user_id: UUID
) -> bool:
    """Return True if caller or org has exceeded their rate limit in the last 60 seconds."""
    cutoff = datetime.datetime.now(datetime.UTC) - datetime.timedelta(seconds=60)

    user_calls = (
        await session.scalar(
            select(func.count(AICall.id)).where(
                AICall.org_id == org_id,
                AICall.user_id == user_id,
                AICall.created_at >= cutoff,
                AICall.status != "rate_limited",
            )
        )
        or 0
    )
    if user_calls >= settings.AI_LIMIT_USER_PER_MIN:
        return True

    org_calls = (
        await session.scalar(
            select(func.count(AICall.id)).where(
                AICall.org_id == org_id,
                AICall.created_at >= cutoff,
                AICall.status != "rate_limited",
            )
        )
        or 0
    )
    return org_calls >= settings.AI_LIMIT_ORG_PER_MIN


async def review_plan(
    session: AsyncSession,
    org_id: UUID,
    user_id: UUID,
    plan: Plan,
) -> AIServiceResult:
    """Run plan review agent on a draft plan with rate limits, timeout, and call logging."""
    feature = "plan_review"
    plan_id = plan.id

    # 1. If no key and not in test override mode, return ai_not_configured without logging
    is_overridden = _is_agent_overridden(reviewer_agent)
    has_key = bool(settings.GOOGLE_API_KEY and settings.GOOGLE_API_KEY.strip())
    if not is_overridden and not has_key:
        return AIServiceResult(
            success=False,
            error_code="ai_not_configured",
            error_message="AI features are not configured.",
            status_code=503,
        )

    # 2. Check local rate limit
    is_limited = await _check_rate_limit(session, org_id, user_id)
    if is_limited:
        log_row = AICall(
            org_id=org_id,
            user_id=user_id,
            plan_id=plan_id,
            feature=feature,
            model=settings.AI_MODEL,
            status="rate_limited",
            error_type="local_limit",
            latency_ms=0,
            input_tokens=None,
            output_tokens=None,
        )
        session.add(log_row)
        await session.flush()
        return AIServiceResult(
            success=False,
            error_code="rate_limited",
            error_message="The AI is busy right now. Your plan is safe. Try again in a minute.",
            status_code=429,
            retry_after_seconds=60,
        )

    # 3. Build input and dependencies from database
    task_ids = {str(t.id) for t in plan.tasks}
    tasks_by_id = {
        str(t.id): ReviewTaskInput(
            ref=str(t.id),
            task_type=t.task_type,  # type: ignore
            title=t.title,
            description=t.description,
            why_it_matters=t.why_it_matters,
        )
        for t in plan.tasks
    }
    main_task_id = next(
        (str(t.id) for t in plan.tasks if t.task_type == "main"), None
    )
    deps = ReviewDeps(
        task_ids=task_ids,
        tasks_by_id=tasks_by_id,
        main_task_id=main_task_id,
    )

    main_tasks = [t for t in plan.tasks if t.task_type == "main"]
    sub_tasks = [t for t in plan.tasks if t.task_type == "sub"]
    gtm_tasks = [t for t in plan.tasks if t.task_type == "go_to_market"]

    tasks_prompt_lines = [
        f"Week Starting: {plan.week_start_date}",
        "",
        "MAIN TASK (must have clear why_it_matters and checkable outcome):",
    ]
    for t in main_tasks:
        tasks_prompt_lines.extend(
            [
                f"- Task Ref: {t.id}",
                f"  Title: {t.title}",
                f"  Description: {t.description or 'None'}",
                f"  Why it matters: {t.why_it_matters or 'None'}",
            ]
        )
    if not main_tasks:
        tasks_prompt_lines.append("(No main task present)")

    tasks_prompt_lines.extend(
        [
            "",
            f"SUB-GOALS ({len(sub_tasks)} tasks - must be checkable intermediate outcomes):",
        ]
    )
    for t in sub_tasks:
        tasks_prompt_lines.extend(
            [
                f"- Task Ref: {t.id}",
                f"  Title: {t.title}",
                f"  Description: {t.description or 'None'}",
            ]
        )
    if not sub_tasks:
        tasks_prompt_lines.append("(No sub-goals present)")

    tasks_prompt_lines.extend(
        [
            "",
            f"GO-TO-MARKET TASKS ({len(gtm_tasks)} tasks - must put work in front of users or measure impact):",
        ]
    )
    for t in gtm_tasks:
        tasks_prompt_lines.extend(
            [
                f"- Task Ref: {t.id}",
                f"  Title: {t.title}",
                f"  Description: {t.description or 'None'}",
            ]
        )
    if not gtm_tasks:
        tasks_prompt_lines.append("(No go-to-market tasks present)")

    tasks_prompt_lines.extend(
        [
            "",
            "CRITICAL INSTRUCTIONS FOR REVIEW:",
            "1. You MUST review EVERY task listed above, including all SUB-GOALS and all GO-TO-MARKET TASKS. Do not skip any task.",
            "2. If any task title is a placeholder (e.g. 'test', 'test1', 'test2', 'asdf') or not checkable, you MUST flag it as a blocker with a concrete rewrite.",
            "3. Evaluate all GO-TO-MARKET tasks specifically: do they actually put the main outcome in front of users or measure its impact? If placeholder, vague, or not a real GTM outcome, flag it as a blocker with a concrete go-to-market rewrite.",
        ]
    )
    prompt = "\n".join(tasks_prompt_lines)

    # 4. Determine model to pass
    model_to_use = None if is_overridden else get_default_model()

    start_time = time.perf_counter()
    try:
        async with asyncio.timeout(settings.AI_TIMEOUT_SECONDS):
            if model_to_use is not None:
                result = await reviewer_agent.run(prompt, deps=deps, model=model_to_use)
            else:
                result = await reviewer_agent.run(prompt, deps=deps)

        latency_ms = int((time.perf_counter() - start_time) * 1000)

        # Extract tokens
        usage = getattr(result, "usage", None)
        if callable(usage):
            usage = usage()
        in_tokens = getattr(usage, "input_tokens", None) if usage else None
        out_tokens = getattr(usage, "output_tokens", None) if usage else None

        log_row = AICall(
            org_id=org_id,
            user_id=user_id,
            plan_id=plan_id,
            feature=feature,
            model=settings.AI_MODEL,
            status="success",
            error_type=None,
            latency_ms=latency_ms,
            input_tokens=in_tokens,
            output_tokens=out_tokens,
        )
        session.add(log_row)
        await session.flush()

        return AIServiceResult(
            success=True,
            data=result.output,
            model=settings.AI_MODEL,
        )

    except Exception as exc:  # noqa: BLE001
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        status_str, err_type, err_code, status_code, err_msg, retry_after = _map_exception(
            exc
        )

        log_row = AICall(
            org_id=org_id,
            user_id=user_id,
            plan_id=plan_id,
            feature=feature,
            model=settings.AI_MODEL,
            status=status_str,
            error_type=err_type,
            latency_ms=latency_ms,
            input_tokens=None,
            output_tokens=None,
        )
        session.add(log_row)
        await session.flush()

        return AIServiceResult(
            success=False,
            error_code=err_code,
            error_message=err_msg,
            status_code=status_code,
            retry_after_seconds=retry_after,
        )


async def draft_plan(
    session: AsyncSession,
    org_id: UUID,
    user_id: UUID,
    notes: str,
    week_start_date: str | None = None,
) -> AIServiceResult:
    """Run plan drafting agent from messy engineer notes."""
    feature = "plan_draft"
    plan_id = None

    # 1. If no key and not in test override mode, return ai_not_configured without logging
    is_overridden = _is_agent_overridden(drafter_agent)
    has_key = bool(settings.GOOGLE_API_KEY and settings.GOOGLE_API_KEY.strip())
    if not is_overridden and not has_key:
        return AIServiceResult(
            success=False,
            error_code="ai_not_configured",
            error_message="AI features are not configured.",
            status_code=503,
        )

    # 2. Check local rate limit
    is_limited = await _check_rate_limit(session, org_id, user_id)
    if is_limited:
        log_row = AICall(
            org_id=org_id,
            user_id=user_id,
            plan_id=plan_id,
            feature=feature,
            model=settings.AI_MODEL,
            status="rate_limited",
            error_type="local_limit",
            latency_ms=0,
            input_tokens=None,
            output_tokens=None,
        )
        session.add(log_row)
        await session.flush()
        return AIServiceResult(
            success=False,
            error_code="rate_limited",
            error_message="The AI is busy right now. Your plan is safe. Try again in a minute.",
            status_code=429,
            retry_after_seconds=60,
        )

    # 3. Build prompt wrapping notes in delimiters
    prompt = (
        "Please transform the following engineer notes into a structured weekly draft plan.\n"
        "<notes>\n"
        f"{notes}\n"
        "</notes>\n"
    )
    if week_start_date:
        prompt += f"Target week start date: {week_start_date}\n"

    # 4. Determine model to pass
    model_to_use = None if is_overridden else get_default_model()

    start_time = time.perf_counter()
    try:
        async with asyncio.timeout(settings.AI_TIMEOUT_SECONDS):
            if model_to_use is not None:
                result = await drafter_agent.run(prompt, model=model_to_use)
            else:
                result = await drafter_agent.run(prompt)

        latency_ms = int((time.perf_counter() - start_time) * 1000)

        usage = getattr(result, "usage", None)
        if callable(usage):
            usage = usage()
        in_tokens = getattr(usage, "input_tokens", None) if usage else None
        out_tokens = getattr(usage, "output_tokens", None) if usage else None

        log_row = AICall(
            org_id=org_id,
            user_id=user_id,
            plan_id=plan_id,
            feature=feature,
            model=settings.AI_MODEL,
            status="success",
            error_type=None,
            latency_ms=latency_ms,
            input_tokens=in_tokens,
            output_tokens=out_tokens,
        )
        session.add(log_row)
        await session.flush()

        return AIServiceResult(
            success=True,
            data=result.output,
            model=settings.AI_MODEL,
        )

    except Exception as exc:  # noqa: BLE001
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        status_str, err_type, err_code, status_code, err_msg, retry_after = _map_exception(
            exc
        )

        log_row = AICall(
            org_id=org_id,
            user_id=user_id,
            plan_id=plan_id,
            feature=feature,
            model=settings.AI_MODEL,
            status=status_str,
            error_type=err_type,
            latency_ms=latency_ms,
            input_tokens=None,
            output_tokens=None,
        )
        session.add(log_row)
        await session.flush()

        return AIServiceResult(
            success=False,
            error_code=err_code,
            error_message=err_msg,
            status_code=status_code,
            retry_after_seconds=retry_after,
        )


def _map_exception(exc: Exception) -> tuple[str, str, str, int, str, int | None]:
    """Map exceptions to (ai_calls.status, error_type, response_code, http_status, message, retry_after)."""
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return (
            "timeout",
            "timeout",
            "timeout",
            503,
            "The AI request timed out. Your plan is safe. Try again in a moment.",
            None,
        )

    if isinstance(exc, UnexpectedModelBehavior):
        return (
            "invalid_output",
            "invalid_output",
            "invalid_output",
            503,
            "The AI returned an invalid response. Your plan is safe. Please try again.",
            None,
        )

    if (
        isinstance(exc, ModelHTTPError) and getattr(exc, "status_code", None) == 429
    ) or getattr(exc, "status_code", None) == 429:
        return (
            "rate_limited",
            "provider_429",
            "rate_limited",
            429,
            "The AI is busy right now. Your plan is safe. Try again in a minute.",
            60,
        )

    return (
        "failed",
        type(exc).__name__,
        "unavailable",
        503,
        "The AI is unavailable right now. Your plan is safe. Please try again later.",
        None,
    )
