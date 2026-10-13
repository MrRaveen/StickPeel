from __future__ import annotations

import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select

from app.api.internal.schemas import (
    AiUsageListResponse,
    AiUsageRow,
    AiUsageTotals,
)
from app.database import DBSession
from app.exceptions import ResourceNotFoundException
from app.models import AICall, Organization
from app.rbac import require_platform_permission
from app.schemas import Model

router = APIRouter(tags=["ai-usage"])


class DailyAiUsageItem(Model):
    date: str
    total_calls: int = 0
    success: int = 0
    failed: int = 0
    rate_limited: int = 0
    timeout: int = 0
    invalid_output: int = 0


@router.get(
    "/ai-usage",
    dependencies=[Depends(require_platform_permission("platform.ai_usage.view"))],
)
async def get_ai_usage(
    session: DBSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    org_id: UUID | None = Query(None),
    from_date: datetime.datetime | None = Query(None, alias="from"),
    to_date: datetime.datetime | None = Query(None, alias="to"),
) -> AiUsageListResponse:
    """Get platform AI usage totals and per-organization breakdowns (counts only, no prompts or outputs)."""
    base_filters = []
    if org_id is not None:
        base_filters.append(AICall.org_id == org_id)
    if from_date is not None:
        base_filters.append(AICall.created_at >= from_date)
    if to_date is not None:
        base_filters.append(AICall.created_at <= to_date)

    # Totals across all filtered calls
    totals_stmt = select(
        func.count(AICall.id),
        func.count(case((AICall.status == "success", AICall.id))),
        func.count(case((AICall.status == "failed", AICall.id))),
        func.count(case((AICall.status == "rate_limited", AICall.id))),
        func.count(case((AICall.status == "timeout", AICall.id))),
        func.count(case((AICall.status == "invalid_output", AICall.id))),
    )
    if base_filters:
        totals_stmt = totals_stmt.where(*base_filters)

    tot_row = (await session.execute(totals_stmt)).first()
    totals = AiUsageTotals(
        total_calls=tot_row[0] if tot_row else 0,
        success=tot_row[1] if tot_row else 0,
        failed=tot_row[2] if tot_row else 0,
        rate_limited=tot_row[3] if tot_row else 0,
        timeout=tot_row[4] if tot_row else 0,
        invalid_output=tot_row[5] if tot_row else 0,
    )

    # Group by org
    grouped_stmt = (
        select(
            AICall.org_id,
            Organization.name,
            func.count(AICall.id).label("total_calls"),
            func.count(case((AICall.status == "success", AICall.id))).label("success"),
            func.count(case((AICall.status == "failed", AICall.id))).label("failed"),
            func.count(case((AICall.status == "rate_limited", AICall.id))).label("rate_limited"),
            func.count(case((AICall.status == "timeout", AICall.id))).label("timeout"),
            func.count(case((AICall.status == "invalid_output", AICall.id))).label("invalid_output"),
            func.max(AICall.created_at).label("last_call_at"),
        )
        .join(Organization, Organization.id == AICall.org_id)
    )
    if base_filters:
        grouped_stmt = grouped_stmt.where(*base_filters)
    grouped_stmt = grouped_stmt.group_by(AICall.org_id, Organization.name)

    count_stmt = select(func.count()).select_from(grouped_stmt.subquery())
    total_orgs = (await session.scalar(count_stmt)) or 0

    offset = (page - 1) * page_size
    paged_stmt = grouped_stmt.order_by(func.count(AICall.id).desc()).offset(offset).limit(page_size)

    rows = (await session.execute(paged_stmt)).all()

    items = [
        AiUsageRow(
            org_id=r[0],
            org_name=r[1],
            total_calls=r[2],
            success=r[3],
            failed=r[4],
            rate_limited=r[5],
            timeout=r[6],
            invalid_output=r[7],
            last_call_at=r[8],
        )
        for r in rows
    ]

    return AiUsageListResponse(
        items=items,
        total=total_orgs,
        page=page,
        page_size=page_size,
        totals=totals,
    )


@router.get(
    "/ai-usage/{org_id}",
    dependencies=[Depends(require_platform_permission("platform.ai_usage.view"))],
)
async def get_org_daily_ai_usage(
    org_id: UUID,
    session: DBSession,
    from_date: datetime.datetime | None = Query(None, alias="from"),
    to_date: datetime.datetime | None = Query(None, alias="to"),
) -> list[DailyAiUsageItem]:
    """Get daily AI usage counts for an organization (for charts)."""
    org = await session.get(Organization, org_id)
    if not org:
        raise ResourceNotFoundException("Organization not found")

    day_col = func.date_trunc("day", AICall.created_at).label("day")
    stmt = (
        select(
            day_col,
            func.count(AICall.id).label("total_calls"),
            func.count(case((AICall.status == "success", AICall.id))).label("success"),
            func.count(case((AICall.status == "failed", AICall.id))).label("failed"),
            func.count(case((AICall.status == "rate_limited", AICall.id))).label("rate_limited"),
            func.count(case((AICall.status == "timeout", AICall.id))).label("timeout"),
            func.count(case((AICall.status == "invalid_output", AICall.id))).label("invalid_output"),
        )
        .where(AICall.org_id == org_id)
    )
    if from_date is not None:
        stmt = stmt.where(AICall.created_at >= from_date)
    if to_date is not None:
        stmt = stmt.where(AICall.created_at <= to_date)

    stmt = stmt.group_by(day_col).order_by(day_col.asc())

    rows = (await session.execute(stmt)).all()

    return [
        DailyAiUsageItem(
            date=r[0].strftime("%Y-%m-%d") if isinstance(r[0], datetime.datetime) else str(r[0]),
            total_calls=r[1],
            success=r[2],
            failed=r[3],
            rate_limited=r[4],
            timeout=r[5],
            invalid_output=r[6],
        )
        for r in rows
    ]
