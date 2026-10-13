"""User routes.

Route permission matrix:
  GET /users/self — requires "org.view" (scope: org) OR any authenticated user
                    (caller always sees their own record; no cross-user access)

Since /users/self only returns the caller's own row, we require only a valid
JWT (CurrentUser dependency). No org permission is enforced here because the
user may not belong to any org yet (e.g. after sign-up before joining one).
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.app.access import CurrentUser
from app.api.app.schemas import UserResponse

router = APIRouter()


@router.get("/users/self", tags=["users"])
async def get_current_user(current_user: CurrentUser) -> UserResponse:
    """Return the currently authenticated user's own profile.

    Access: valid JWT required. No org membership needed.
    """
    return UserResponse.model_validate(current_user)
