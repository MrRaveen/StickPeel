"""Auth routes: login + create-account.

Both customer users (is_admin=False) and platform staff (is_admin=True) use
the same /login endpoint. The token audience is always JWT_AUDIENCE_APP so
the token can be used on /app routes. Platform staff authenticate separately
on the internal surface when they need /internal access.

create-account only creates regular (non-staff) users; is_admin is always
forced to False so the sign-up path can never produce a staff account.

Route permission matrix:
  POST /login          — PUBLIC (no permission required)
  POST /logout         — PUBLIC
  POST /create-account — PUBLIC (no permission required; creates customer accounts only)
"""
from __future__ import annotations

from fastapi import APIRouter, Response, status
from sqlalchemy import select

from app.api.app.schemas import AuthRequest, AuthResponse, CreateAccountRequest, UserResponse
from app.config import settings
from app.database import DBSession
from app.exceptions import APIException
from app.models import User
from app.security import (
    JWT_AUDIENCE_APP,
    JWT_AUDIENCE_INTERNAL,
    generate_jwt_token,
    hash_password,
    verify_password,
)
from app.services.users import UserService

router = APIRouter(tags=["auth"])


@router.post("/login")
async def login(
    auth_request: AuthRequest,
    session: DBSession,
    response: Response,
) -> AuthResponse:
    """Authenticate any user (customer or platform staff) and return a JWT.

    Customer tokens carry surface="app" and audience="app".
    Staff tokens carry surface="internal" and audience="internal".
    A customer token is rejected on /internal and a staff token is rejected on /app.
    """
    result = await session.execute(
        select(User).where(User.email == auth_request.email.lower())
    )
    user = result.scalars().first()

    if (
        user is None
        or not user.is_active
        or user.password_hash is None
        or not verify_password(auth_request.password, user.password_hash)
    ):
        raise APIException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="INVALID_CREDENTIALS",
            message="Incorrect email or password.",
        )

    if user.is_admin:
        token_audience = JWT_AUDIENCE_INTERNAL
        surface = "internal"
        cookie_name = "internal_access_token"
    else:
        token_audience = JWT_AUDIENCE_APP
        surface = "app"
        cookie_name = "access_token"

    access_token = generate_jwt_token(
        {"sub": str(user.id), "surface": surface},
        audience=token_audience,
    )

    response.set_cookie(
        key=cookie_name,
        value=f"Bearer {access_token}",
        samesite="lax",
        secure=settings.SECURE_COOKIE,
        httponly=True,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    return AuthResponse(
        access_token=access_token,
        user_id=str(user.id),
        is_admin=user.is_admin,
    )


@router.post("/logout")
async def logout(response: Response):
    """Clear auth cookies."""
    response.delete_cookie("access_token")
    response.delete_cookie("internal_access_token")
    return {"message": "Successfully logged out"}


@router.post("/create-account", status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: CreateAccountRequest,
    session: DBSession,
) -> UserResponse:
    """Register a new customer account.

    Platform staff accounts are never created through this endpoint;
    ``is_admin`` is always forced to ``False``.
    """
    svc = UserService(session)
    user = await svc.create_user(
        first_name=payload.first_name,
        last_name=payload.last_name,
        email=payload.email,
        password=payload.password,
        is_admin=False,   # Hard rule: sign-up never produces a staff account
        is_active=True,
    )
    await session.commit()
    return UserResponse.model_validate(user)
