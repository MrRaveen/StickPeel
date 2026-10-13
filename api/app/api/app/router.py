from fastapi.routing import APIRouter

from .routers import ai, auth, invitations, meta, orgs, users

router = APIRouter()

router.include_router(meta.router)
router.include_router(auth.router)
router.include_router(users.router)
router.include_router(ai.router)
router.include_router(orgs.router)
router.include_router(invitations.router)
