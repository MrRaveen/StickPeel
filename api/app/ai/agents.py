"""Pydantic AI agents for plan review and plan drafting."""

from __future__ import annotations

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google import GoogleProvider

from app.ai.prompts import DRAFTER_SYSTEM_PROMPT, REVIEWER_SYSTEM_PROMPT
from app.ai.schemas import PlanDraft, PlanReview, ReviewDeps
from app.config import settings


def get_default_model() -> GoogleModel | str | None:
    """Build the Gemini model from settings, or return None if GOOGLE_API_KEY is unset."""
    api_key = settings.GOOGLE_API_KEY
    if api_key and api_key.strip():
        try:
            return GoogleModel(
                settings.AI_MODEL,
                provider=GoogleProvider(api_key=api_key.strip()),
            )
        except Exception:  # noqa: BLE001
            return None
    return None


reviewer_agent = Agent(
    model=get_default_model(),
    deps_type=ReviewDeps,
    output_type=PlanReview,
    system_prompt=REVIEWER_SYSTEM_PROMPT,
)


@reviewer_agent.output_validator
def validate_plan_review(ctx: RunContext[ReviewDeps], review: PlanReview) -> PlanReview:
    """Validate the PlanReview output against plan data and domain constraints."""
    if len(review.findings) > 10:
        raise ModelRetry("Maximum 10 findings allowed. Consolidate your feedback.")

    if review.verdict == "approve":
        has_blockers = any(f.severity == "blocker" for f in review.findings)
        if has_blockers:
            raise ModelRetry(
                "A verdict of 'approve' cannot have blocker findings. Either change verdict to 'adjust' or reduce severity to 'suggestion'."
            )

    for f in review.findings:
        # 1. Every task_ref is in the input ids, or is "plan"
        if f.task_ref != "plan" and f.task_ref not in ctx.deps.task_ids:
            raise ModelRetry(
                f"Task reference '{f.task_ref}' does not exist in the plan. task_ref must be one of {sorted(ctx.deps.task_ids)} or 'plan'."
            )

        # 2. rewrite needs a real task id and a target_field
        if f.action == "rewrite":
            if f.task_ref == "plan":
                raise ModelRetry(
                    "Action 'rewrite' cannot target 'plan'. It must reference a specific task ID."
                )
            if not f.target_field:
                raise ModelRetry(
                    "Action 'rewrite' requires target_field ('title', 'description', or 'why_it_matters')."
                )
            if f.suggested_task_type is not None:
                raise ModelRetry(
                    "Action 'rewrite' should not specify suggested_task_type."
                )

        # 3. add needs task_ref = "plan" and a suggested_task_type. Never main.
        if f.action == "add":
            if f.task_ref != "plan":
                raise ModelRetry(
                    "Action 'add' must have task_ref='plan'."
                )
            if not f.suggested_task_type or f.suggested_task_type not in (
                "sub",
                "go_to_market",
            ):
                raise ModelRetry(
                    "Action 'add' must specify suggested_task_type as 'sub' or 'go_to_market'. Never 'main'."
                )

        # 4. missing_why must target the main task's why_it_matters
        if f.issue_type == "missing_why":
            if not ctx.deps.main_task_id:
                raise ModelRetry("Issue 'missing_why' flagged but plan has no main task.")
            if f.task_ref != ctx.deps.main_task_id or f.target_field != "why_it_matters":
                raise ModelRetry(
                    f"Issue 'missing_why' must target the main task ('{ctx.deps.main_task_id}') with target_field='why_it_matters'."
                )

        # 5. suggested_text is not empty
        if not f.suggested_text or not f.suggested_text.strip():
            raise ModelRetry("suggested_text cannot be empty.")

        # 6. title rewrites are 255 characters or fewer
        if (
            f.action == "rewrite"
            and f.target_field == "title"
            and len(f.suggested_text) > 255
        ):
            raise ModelRetry(
                f"Suggested title must be 255 characters or fewer (got {len(f.suggested_text)} chars)."
            )

        # 7. suggested_text differs from the current text
        if (
            f.action == "rewrite"
            and f.target_field
            and f.task_ref in ctx.deps.tasks_by_id
        ):
            current_task = ctx.deps.tasks_by_id[f.task_ref]
            current_val = getattr(current_task, f.target_field, None) or ""
            if f.suggested_text.strip() == current_val.strip():
                raise ModelRetry(
                    f"suggested_text must differ from the current {f.target_field} text."
                )

    return review


drafter_agent = Agent(
    model=get_default_model(),
    output_type=PlanDraft,
    system_prompt=DRAFTER_SYSTEM_PROMPT,
)


@drafter_agent.output_validator
def validate_plan_draft(draft: PlanDraft) -> PlanDraft:
    """Validate the PlanDraft output structure and constraints."""
    if not draft.main_task.title or not draft.main_task.title.strip():
        raise ModelRetry("Main task title cannot be empty.")
    if len(draft.main_task.title) > 255:
        raise ModelRetry("Main task title must be 255 characters or fewer.")
    if not draft.main_task.why_it_matters or not draft.main_task.why_it_matters.strip():
        raise ModelRetry("Main task why_it_matters is required and cannot be empty.")

    if len(draft.sub_goals) > 5:
        raise ModelRetry("Maximum 5 sub_goals allowed.")
    for sg in draft.sub_goals:
        if not sg.title or not sg.title.strip():
            raise ModelRetry("Sub-goal title cannot be empty.")
        if len(sg.title) > 255:
            raise ModelRetry("Sub-goal title must be 255 characters or fewer.")

    if len(draft.go_to_market) > 4:
        raise ModelRetry("Maximum 4 go_to_market tasks allowed.")
    for gtm in draft.go_to_market:
        if not gtm.title or not gtm.title.strip():
            raise ModelRetry("Go-to-market task title cannot be empty.")
        if len(gtm.title) > 255:
            raise ModelRetry("Go-to-market task title must be 255 characters or fewer.")

    if len(draft.unclear) > 5:
        raise ModelRetry("Maximum 5 unclear items allowed.")

    return draft
