import uuid
import jwt
import pytest
from faker import Faker
from sqlalchemy import func, select

from app.config import settings
from app.models import Membership, Organization, Permission, Role, RolePermission, User
from app.security import (
    JWT_AUDIENCE_APP,
    JWT_AUDIENCE_INTERNAL,
    generate_jwt_token,
    hash_password,
)

fake = Faker()


@pytest.mark.asyncio
async def test_health_endpoint_healthy(async_client):
    """Test health endpoint returns healthy status when database is accessible."""
    response = await async_client.get("/app/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


@pytest.mark.asyncio
async def test_auth_endpoint_removed(async_client):
    """Test that POST /app/auth has been removed (Launchbase duplicate)."""
    response = await async_client.post(
        "/app/auth",
        json={"email": "test@example.com", "password": "password123"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_customer_login_success(async_client, session_factory):
    """Customer login returns JWT with surface='app' and audience='app'."""
    email = fake.email().lower()
    password = "customerpassword123"

    async with session_factory() as db:
        user = User(
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            email=email,
            password=hash_password(password),
            is_active=True,
            is_admin=False,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_id = user.id

    auth_data = {"email": email, "password": password}
    response = await async_client.post("/app/login", json=auth_data)

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user_id"] == str(user_id)
    assert data["is_admin"] is False

    # Check cookies: customer gets 'access_token' cookie
    assert "access_token" in async_client.cookies
    assert "internal_access_token" not in async_client.cookies

    # Verify JWT surface claim
    payload = jwt.decode(
        data["access_token"],
        settings.SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        audience=JWT_AUDIENCE_APP,
    )
    assert payload["sub"] == str(user_id)
    assert payload["aud"] == "app"
    assert payload["surface"] == "app"


@pytest.mark.asyncio
async def test_staff_login_success(async_client, session_factory):
    """Platform staff login returns JWT with surface='internal' and audience='internal'."""
    email = fake.email().lower()
    password = "staffpassword123"

    async with session_factory() as db:
        user = User(
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            email=email,
            password=hash_password(password),
            is_active=True,
            is_admin=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_id = user.id

    auth_data = {"email": email, "password": password}
    response = await async_client.post("/app/login", json=auth_data)

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user_id"] == str(user_id)
    assert data["is_admin"] is True

    # Check cookies: staff gets 'internal_access_token' cookie
    assert "internal_access_token" in async_client.cookies
    assert "access_token" not in async_client.cookies

    # Verify JWT surface claim
    payload = jwt.decode(
        data["access_token"],
        settings.SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        audience=JWT_AUDIENCE_INTERNAL,
    )
    assert payload["sub"] == str(user_id)
    assert payload["aud"] == "internal"
    assert payload["surface"] == "internal"


@pytest.mark.asyncio
async def test_staff_token_rejected_on_app(async_client, session_factory):
    """Staff token is rejected on /app routes."""
    email = fake.email().lower()
    password = "staffpassword123"

    async with session_factory() as db:
        user = User(
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            email=email,
            password=hash_password(password),
            is_active=True,
            is_admin=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    # Login as staff (sets internal_access_token cookie)
    login_resp = await async_client.post("/app/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200
    staff_token = login_resp.json()["access_token"]

    # 1. Calling /app without app cookie -> 401
    resp = await async_client.get("/app/users/self")
    assert resp.status_code == 401

    # 2. Calling /app with staff token in header -> 401 (rejected surface/aud/staff check)
    resp = await async_client.get("/app/users/self", headers={"Access-Token": f"Bearer {staff_token}"})
    assert resp.status_code == 401

    # 3. Calling /app with staff token in access_token cookie -> 401
    async_client.cookies.set("access_token", f"Bearer {staff_token}")
    resp = await async_client.get("/app/users/self")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_customer_token_rejected_on_internal(async_client, session_factory):
    """Customer token is rejected on /internal routes."""
    email = fake.email().lower()
    password = "customerpassword123"

    async with session_factory() as db:
        user = User(
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            email=email,
            password=hash_password(password),
            is_active=True,
            is_admin=False,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    # Login as customer (sets access_token cookie)
    login_resp = await async_client.post("/app/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200
    customer_token = login_resp.json()["access_token"]

    # 1. Calling /internal without internal_access_token cookie -> 401
    resp = await async_client.get("/internal/orgs")
    assert resp.status_code == 401

    # 2. Calling /internal with customer token in header -> 401
    resp = await async_client.get("/internal/orgs", headers={"Access-Token": f"Bearer {customer_token}"})
    assert resp.status_code == 401

    # 3. Calling /internal with customer token in internal_access_token cookie -> 401
    async_client.cookies.set("internal_access_token", f"Bearer {customer_token}")
    resp = await async_client.get("/internal/orgs")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_invalid_credentials(async_client, session_factory):
    """Login failures for nonexistent user, wrong password, or bad format."""
    # Non-existent email
    resp = await async_client.post("/app/login", json={"email": "nonexistent@example.com", "password": "any"})
    assert resp.status_code == 401

    # Existing user, wrong password
    email = fake.email().lower()
    async with session_factory() as db:
        user = User(
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            email=email,
            password=hash_password("correctpassword"),
            is_active=True,
        )
        db.add(user)
        await db.commit()

    resp = await async_client.post("/app/login", json={"email": email, "password": "wrongpassword"})
    assert resp.status_code == 401

    # Missing password
    resp = await async_client.post("/app/login", json={"email": email})
    assert resp.status_code == 422

    # Invalid email format
    resp = await async_client.post("/app/login", json={"email": "not-an-email", "password": "pass"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_logout_success(async_client):
    """Logout clears cookies."""
    response = await async_client.post("/app/logout")

    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Successfully logged out"


@pytest.mark.asyncio
async def test_create_account_success(async_client, session_factory):
    """POST /app/create-account registers a customer account without creating an org."""
    email = fake.email().lower()
    payload = {
        "first_name": "Alice",
        "last_name": "Smith",
        "email": email,
        "password": "securepassword123",
    }
    response = await async_client.post("/app/create-account", json=payload)

    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["first_name"] == "Alice"
    assert data["last_name"] == "Smith"
    assert data["email"] == email
    assert "is_admin" not in data  # Schema does not expose is_admin

    user_id = uuid.UUID(data["id"])

    # Verify database state
    async with session_factory() as db:
        user = await db.get(User, user_id)
        assert user is not None
        assert user.is_admin is False  # Never staff
        assert user.is_active is True

        # Ensure NO organization or membership was created
        org_count = await db.scalar(select(func.count()).select_from(Organization))
        mem_count = await db.scalar(
            select(func.count()).select_from(Membership).where(Membership.user_id == user_id)
        )
        assert mem_count == 0


@pytest.mark.asyncio
async def test_create_account_forbids_is_admin_and_extra_fields(async_client):
    """POST /app/create-account schema forbids is_admin and any extra fields (returns 422)."""
    # 1. Passing is_admin=True
    resp = await async_client.post(
        "/app/create-account",
        json={
            "first_name": "Bob",
            "last_name": "Jones",
            "email": fake.email().lower(),
            "password": "password123",
            "is_admin": True,
        },
    )
    assert resp.status_code == 422

    # 2. Passing is_admin=False
    resp = await async_client.post(
        "/app/create-account",
        json={
            "first_name": "Bob",
            "last_name": "Jones",
            "email": fake.email().lower(),
            "password": "password123",
            "is_admin": False,
        },
    )
    assert resp.status_code == 422

    # 3. Passing extra unknown field
    resp = await async_client.post(
        "/app/create-account",
        json={
            "first_name": "Bob",
            "last_name": "Jones",
            "email": fake.email().lower(),
            "password": "password123",
            "org_name": "My Org",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_account_duplicate_email(async_client, session_factory):
    """POST /app/create-account returns 409 Conflict when email already exists."""
    email = fake.email().lower()
    async with session_factory() as db:
        user = User(
            first_name="First",
            last_name="User",
            email=email,
            password=hash_password("password123"),
            is_active=True,
            is_admin=False,
        )
        db.add(user)
        await db.commit()

    # Attempt to create account with duplicate email
    resp = await async_client.post(
        "/app/create-account",
        json={
            "first_name": "Second",
            "last_name": "User",
            "email": email,
            "password": "newpassword123",
        },
    )
    assert resp.status_code == 409
    data = resp.json()
    assert data["code"] == "CONFLICT"


@pytest.mark.asyncio
async def test_request_rechecks_inactive_user(async_client, session_factory):
    """Every request re-checks user.is_active; deactivating user rejects subsequent calls with 401."""
    email = fake.email().lower()
    password = "password123"

    async with session_factory() as db:
        user = User(
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            email=email,
            password=hash_password(password),
            is_active=True,
            is_admin=False,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_id = user.id

    # Log in
    login_resp = await async_client.post("/app/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]

    # Initial request works
    resp = await async_client.get("/app/users/self")
    assert resp.status_code == 200

    # Deactivate user in database
    async with session_factory() as db:
        u = await db.get(User, user_id)
        u.is_active = False
        await db.commit()

    # Subsequent request fails with 401 INACTIVE_USER
    resp = await async_client.get("/app/users/self")
    assert resp.status_code == 401
    assert resp.json()["code"] == "INACTIVE_USER"


@pytest.mark.asyncio
async def test_request_rechecks_suspended_org(async_client, session_factory):
    """Every request re-checks org.is_suspended; suspending org rejects subsequent calls with 403."""
    email = fake.email().lower()
    password = "password123"

    async with session_factory() as db:
        user = User(
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            email=email,
            password=hash_password(password),
            is_active=True,
            is_admin=False,
        )
        db.add(user)
        await db.flush()

        org = Organization(name="Active Org", is_suspended=False)
        db.add(org)
        await db.flush()

        role = Role(name="org_member", scope="org", is_sys=True)
        db.add(role)
        await db.flush()

        perm = (
            await db.execute(
                select(Permission).where(Permission.permission_code == "org.view")
            )
        ).scalar_one_or_none()
        if not perm:
            perm = Permission(permission_code="org.view")
            db.add(perm)
            await db.flush()

        rp = RolePermission(role_id=role.id, permission_id=perm.id)
        db.add(rp)

        mem = Membership(user_id=user.id, org_id=org.id, role_id=role.id, status="active")
        db.add(mem)
        await db.commit()

        user_id = user.id
        org_id = org.id

    # Log in
    login_resp = await async_client.post("/app/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200

    # Initial request to org succeeds
    resp = await async_client.get(f"/app/orgs/{org_id}/permissions")
    assert resp.status_code == 200

    # Suspend organization in database
    async with session_factory() as db:
        o = await db.get(Organization, org_id)
        o.is_suspended = True
        await db.commit()

    # Subsequent request is immediately blocked with 403 ORG_SUSPENDED
    resp = await async_client.get(f"/app/orgs/{org_id}/permissions")
    assert resp.status_code == 403
    assert resp.json()["code"] == "ORG_SUSPENDED"
