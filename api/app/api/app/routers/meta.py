from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.database import DBSession
from app.logging import logger
from app.schemas import HealthCheckResponse

router = APIRouter(tags=["meta"])


@router.get("/health")
async def health(session: DBSession, response: Response) -> HealthCheckResponse:
    try:
        # Check database connectivity
        await session.execute(text("SELECT 1"))
        return HealthCheckResponse(status="healthy")

    except Exception:
        # Log the traceback internally but don't expose details
        logger.exception("Health check failed")
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthCheckResponse(status="unhealthy")
