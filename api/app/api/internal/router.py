from fastapi.routing import APIRouter

from .routers import ai_usage, meta, orgs, staff, users

router = APIRouter()

router.include_router(meta.router)
router.include_router(orgs.router)
router.include_router(users.router)
router.include_router(ai_usage.router)
router.include_router(staff.router)
