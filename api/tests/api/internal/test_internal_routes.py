from __future__ import annotations

import uuid
import jwt
import pytest
from faker import Faker
from sqlalchemy import select

from app.config import settings
from app.models import (
    AICall,
    Membership,
    Organization,
    Permission,
    Plan,
    PlatformMember,
    Role,
    RolePermission,
    StaffAuditLog,
    User,
)
from app.security import (
    JWT_AUDIENCE_APP,
    JWT_AUDIENCE_INTERNAL,
    generate_jwt_token,
    hash_password,
)

fake = Faker()


async def setup_platform_role(session, role_name: str, permission_codes: list[str]) -> Role:
    role = (
        await session.execute(
            select(Role).where(Role.name == role_name, Role.scope == "platform")
        )
    ).scalar_one_or_none()
    if not role:
        role = Role(name=role_name, scope="platform", is_sys=True)
        session.add(role)
        await session.flush()

    for code in permission_codes:
        perm = (
            await session.execute(
                select(Permission).where(Permission.permission_code == code)
            )
        ).scalar_one_or_none()
        if not perm:
            perm = Permission(permission_code=code)
            session.add(perm)
            await session.flush()

        rp = (
            await session.execute(
                select(RolePermission).where(
                    RolePermission.role_id == role.id,
                    RolePermission.permission_id == perm.id,
                )
            )
        ).scalar_one_or_none()
        if not rp:
            rp = RolePermission(role_id=role.id, permission_id=perm.id)
            session.add(rp)

    await session.flush()
    return role


@pytest.mark.asyncio
async def test_internal_unauthenticated_or_customer_token_rejected(async_client, session_factory):
    # 1. No token -> 401
    resp = await async_client.get("/internal/orgs")
    assert resp.status_code == 401

    # 2. App token on internal surface -> 401
    async with session_factory() as session:
        user = User(
            email=fake.email().lower(),
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(user)
        await session.commit()
        user_id = user.id

    app_token = generate_jwt_token({"sub": str(user_id)}, audience=JWT_AUDIENCE_APP)
    async_client.cookies.set("internal_access_token", f"Bearer {app_token}")
    resp = await async_client.get("/internal/orgs")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_internal_admin_without_platform_role_forbidden(async_client, session_factory):
    async with session_factory() as session:
        user = User(
            email=fake.email().lower(),
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(user)
        await session.commit()
        user_id = user.id

    internal_token = generate_jwt_token({"sub": str(user_id)}, audience=JWT_AUDIENCE_INTERNAL)
    async_client.cookies.set("internal_access_token", f"Bearer {internal_token}")

    resp = await async_client.get("/internal/orgs")
    assert resp.status_code == 403
    assert resp.json()["detail"][0]["type"] == "not_authorized"


@pytest.mark.asyncio
async def test_internal_platform_permissions_enforcement(async_client, session_factory):
    async with session_factory() as session:
        # Create viewer role with only view permissions
        viewer_role = await setup_platform_role(
            session,
            role_name="test_viewer",
            permission_codes=["platform.org.view", "platform.user.view", "platform.ai_usage.view"],
        )

        viewer_user = User(
            email=fake.email().lower(),
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(viewer_user)
        await session.flush()

        pm = PlatformMember(user_id=viewer_user.id, role_id=viewer_role.id)
        session.add(pm)

        # Create super_admin role with all permissions
        super_admin_role = await setup_platform_role(
            session,
            role_name="test_super_admin",
            permission_codes=[
                "platform.org.view",
                "platform.org.suspend",
                "platform.user.view",
                "platform.user.deactivate",
                "platform.ai_usage.view",
                "platform.staff.manage",
                "platform.audit.view",
            ],
        )

        super_admin_user = User(
            email=fake.email().lower(),
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(super_admin_user)
        await session.flush()

        pm_admin = PlatformMember(user_id=super_admin_user.id, role_id=super_admin_role.id)
        session.add(pm_admin)

        # Create a test organization
        test_org = Organization(name="Test Org Co", is_suspended=False)
        session.add(test_org)
        await session.flush()

        # Create another user for deactivation test
        other_user = User(
            email=fake.email().lower(),
            first_name="Target",
            last_name="User",
            password=hash_password("password123"),
            is_active=True,
            is_admin=False,
        )
        session.add(other_user)
        await session.flush()

        await session.commit()

        viewer_id = viewer_user.id
        admin_id = super_admin_user.id
        org_id = test_org.id
        other_user_id = other_user.id

    # Test viewer role permissions
    viewer_token = generate_jwt_token({"sub": str(viewer_id)}, audience=JWT_AUDIENCE_INTERNAL)
    async_client.cookies.set("internal_access_token", f"Bearer {viewer_token}")

    # Allowed for viewer
    assert (await async_client.get("/internal/orgs")).status_code == 200
    assert (await async_client.get("/internal/users")).status_code == 200
    assert (await async_client.get(f"/internal/users/{viewer_id}")).status_code == 200
    assert (await async_client.get("/internal/ai-usage")).status_code == 200

    # Denied for viewer
    suspend_resp = await async_client.post(f"/internal/orgs/{org_id}/suspend")
    assert suspend_resp.status_code == 403
    assert suspend_resp.json()["detail"][0]["type"] == "permission_denied"

    reinstate_resp = await async_client.post(f"/internal/orgs/{org_id}/reinstate")
    assert reinstate_resp.status_code == 403
    assert reinstate_resp.json()["detail"][0]["type"] == "permission_denied"

    deact_resp = await async_client.post(f"/internal/users/{viewer_id}/deactivate")
    assert deact_resp.status_code == 403
    assert deact_resp.json()["detail"][0]["type"] == "permission_denied"

    staff_resp = await async_client.get("/internal/staff")
    assert staff_resp.status_code == 403
    assert staff_resp.json()["detail"][0]["type"] == "permission_denied"

    # Test super_admin role permissions (all allowed)
    admin_token = generate_jwt_token({"sub": str(admin_id)}, audience=JWT_AUDIENCE_INTERNAL)
    async_client.cookies.set("internal_access_token", f"Bearer {admin_token}")

    assert (await async_client.get("/internal/orgs")).status_code == 200
    assert (await async_client.post(f"/internal/orgs/{org_id}/suspend")).status_code == 200
    assert (await async_client.post(f"/internal/orgs/{org_id}/reinstate")).status_code == 200
    assert (await async_client.get("/internal/users")).status_code == 200
    assert (await async_client.get(f"/internal/users/{admin_id}")).status_code == 200
    assert (await async_client.post(f"/internal/users/{other_user_id}/deactivate")).status_code == 200
    assert (await async_client.get("/internal/ai-usage")).status_code == 200
    assert (await async_client.get("/internal/staff")).status_code == 200

    create_staff_resp = await async_client.post(
        "/internal/staff",
        json={
            "email": "new@staff.com",
            "password": "Password123!",
            "first_name": "New",
            "last_name": "Staff",
            "role_name": "viewer",
        },
    )
    assert create_staff_resp.status_code == 201
    created_staff_id = create_staff_resp.json()["user_id"]

    staff_detail = await async_client.get(f"/internal/staff/{created_staff_id}")
    assert staff_detail.status_code == 200
    assert "permissions" in staff_detail.json()
    assert (await async_client.patch(f"/internal/staff/{created_staff_id}", json={})).status_code == 200
    assert (await async_client.delete(f"/internal/staff/{created_staff_id}")).status_code == 204


@pytest.mark.asyncio
async def test_internal_auth_and_logout_flow(async_client, session_factory):
    email = fake.email().lower()
    password = "StaffPassword123!"

    async with session_factory() as session:
        role = await setup_platform_role(
            session,
            role_name="test_support",
            permission_codes=["platform.org.view", "platform.user.view"],
        )
        user = User(
            email=email,
            first_name="Staff",
            last_name="Member",
            password=hash_password(password),
            is_active=True,
            is_admin=True,
        )
        session.add(user)
        await session.flush()

        pm = PlatformMember(user_id=user.id, role_id=role.id)
        session.add(pm)

        # Create customer user (is_admin=False)
        cust_user = User(
            email="cust@example.com",
            first_name="Cust",
            last_name="Omer",
            password=hash_password("password123"),
            is_active=True,
            is_admin=False,
        )
        session.add(cust_user)
        await session.commit()
        user_id = user.id

    # 1. Customer account fails at /internal/auth with generic 401
    resp = await async_client.post(
        "/internal/auth",
        json={"email": "cust@example.com", "password": "password123"},
    )
    assert resp.status_code == 401

    # 2. Staff user succeeds at /internal/auth
    resp = await async_client.post(
        "/internal/auth",
        json={"email": email, "password": password},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["user_id"] == str(user_id)
    assert data["email"] == email
    assert data["role"] == "test_support"
    assert "platform.org.view" in data["permissions"]
    assert "platform.user.view" in data["permissions"]
    assert "internal_access_token" in async_client.cookies

    # 3. GET /internal/users/self
    resp_self = await async_client.get("/internal/users/self")
    assert resp_self.status_code == 200
    self_data = resp_self.json()
    assert self_data["user_id"] == str(user_id)
    assert self_data["role"] == "test_support"
    assert "platform.org.view" in self_data["permissions"]

    # 4. POST /internal/logout clears cookie and returns 204
    resp_logout = await async_client.post("/internal/logout")
    assert resp_logout.status_code == 204

    # Calling self again should fail with 401
    assert (await async_client.get("/internal/users/self")).status_code == 401


@pytest.mark.asyncio
async def test_internal_roles_and_audit_logs(async_client, session_factory):
    async with session_factory() as session:
        admin_role = await setup_platform_role(
            session,
            role_name="super_admin",
            permission_codes=["platform.staff.manage", "platform.audit.view", "platform.org.suspend"],
        )
        admin = User(
            email="superadmin@stickpeel.internal",
            first_name="Super",
            last_name="Admin",
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(admin)
        await session.flush()

        pm = PlatformMember(user_id=admin.id, role_id=admin_role.id)
        session.add(pm)

        org = Organization(name="Audit Co", is_suspended=False)
        session.add(org)
        await session.commit()

        admin_id = admin.id
        org_id = org.id

    token = generate_jwt_token({"sub": str(admin_id)}, audience=JWT_AUDIENCE_INTERNAL)
    async_client.cookies.set("internal_access_token", f"Bearer {token}")

    # 1. GET /internal/roles
    resp_roles = await async_client.get("/internal/roles")
    assert resp_roles.status_code == 200
    roles = resp_roles.json()
    assert isinstance(roles, list)
    assert any(r["name"] == "super_admin" for r in roles)

    # 2. Suspend org writes audit log and returns OrgRow
    resp_susp = await async_client.post(
        f"/internal/orgs/{org_id}/suspend",
        json={"reason": "Terms violation"},
    )
    assert resp_susp.status_code == 200
    susp_data = resp_susp.json()
    assert susp_data["id"] == str(org_id)
    assert susp_data["is_suspended"] is True

    # Suspend again -> 409
    resp_susp_again = await async_client.post(f"/internal/orgs/{org_id}/suspend")
    assert resp_susp_again.status_code == 409

    # Reinstate org returns OrgRow
    resp_reinst = await async_client.post(f"/internal/orgs/{org_id}/reinstate")
    assert resp_reinst.status_code == 200
    reinst_data = resp_reinst.json()
    assert reinst_data["is_suspended"] is False

    # Reinstate again -> 409
    resp_reinst_again = await async_client.post(f"/internal/orgs/{org_id}/reinstate")
    assert resp_reinst_again.status_code == 409

    # 3. GET /internal/audit-logs verifies audit actions org.suspend and org.reinstate
    resp_audit = await async_client.get("/internal/audit-logs")
    assert resp_audit.status_code == 200
    audit_data = resp_audit.json()
    assert audit_data["total"] >= 2
    items = audit_data["items"]
    susp_logs = [i for i in items if i["action"] == "org.suspend" and i["target_id"] == str(org_id)]
    assert len(susp_logs) >= 1
    assert susp_logs[0]["detail"] == "Terms violation"
    assert susp_logs[0]["staff_email"] == "superadmin@stickpeel.internal"

    reinst_logs = [i for i in items if i["action"] == "org.reinstate" and i["target_id"] == str(org_id)]
    assert len(reinst_logs) >= 1


@pytest.mark.asyncio
async def test_internal_orgs_sorting_and_members(async_client, session_factory):
    async with session_factory() as session:
        admin_role = await setup_platform_role(
            session,
            role_name="super_admin",
            permission_codes=["platform.org.view"],
        )
        admin = User(
            email=fake.email().lower(),
            first_name="Admin",
            last_name="One",
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(admin)
        await session.flush()

        pm = PlatformMember(user_id=admin.id, role_id=admin_role.id)
        session.add(pm)

        # Create org with owner member
        org = Organization(name="Members Co", is_suspended=False)
        session.add(org)
        await session.flush()

        org_role = Role(name="owner", scope="org", is_sys=True)
        session.add(org_role)
        await session.flush()

        mem_user = User(
            email="owner@members.co",
            first_name="Alice",
            last_name="Owner",
            password=hash_password("password123"),
            is_active=True,
            is_admin=False,
        )
        session.add(mem_user)
        await session.flush()

        membership = Membership(user_id=mem_user.id, org_id=org.id, role_id=org_role.id, status="active")
        session.add(membership)
        await session.commit()

        admin_id = admin.id
        org_id = org.id
        membership_id = membership.id

    token = generate_jwt_token({"sub": str(admin_id)}, audience=JWT_AUDIENCE_INTERNAL)
    async_client.cookies.set("internal_access_token", f"Bearer {token}")

    # 1. GET /internal/orgs with sorting
    resp_sorted = await async_client.get("/internal/orgs?sort=name")
    assert resp_sorted.status_code == 200
    assert "items" in resp_sorted.json()

    resp_last_active = await async_client.get("/internal/orgs?sort=last_active_at")
    assert resp_last_active.status_code == 200

    # 2. GET /internal/orgs/{org_id} (OrgDetail)
    resp_detail = await async_client.get(f"/internal/orgs/{org_id}")
    assert resp_detail.status_code == 200
    detail = resp_detail.json()
    assert detail["name"] == "Members Co"
    assert len(detail["owners"]) == 1
    assert detail["owners"][0]["email"] == "owner@members.co"
    assert "plans_by_status" in detail
    assert "ai_calls_30d" in detail

    # 3. GET /internal/orgs/{org_id}/members
    resp_members = await async_client.get(f"/internal/orgs/{org_id}/members")
    assert resp_members.status_code == 200
    members_data = resp_members.json()
    assert members_data["total"] == 1
    m_row = members_data["items"][0]
    assert m_row["membership_id"] == str(membership_id)
    assert m_row["email"] == "owner@members.co"
    assert m_row["role"] == "owner"
    assert m_row["status"] == "active"
    assert "name" in m_row
    assert "joined_at" in m_row


@pytest.mark.asyncio
async def test_app_org_suspended_blocks_access(async_client, session_factory):
    async with session_factory() as session:
        user = User(
            email=fake.email().lower(),
            first_name=fake.first_name(),
            last_name=fake.last_name(),
            password=hash_password("password123"),
            is_active=True,
            is_admin=False,
        )
        session.add(user)
        await session.flush()

        org = Organization(name="Suspended Co", is_suspended=True)
        session.add(org)
        await session.flush()

        role = Role(name="org_member", scope="org", is_sys=True)
        session.add(role)
        await session.flush()

        perm = (
            await session.execute(
                select(Permission).where(Permission.permission_code == "org.view")
            )
        ).scalar_one_or_none()
        if not perm:
            perm = Permission(permission_code="org.view")
            session.add(perm)
            await session.flush()

        rp = RolePermission(role_id=role.id, permission_id=perm.id)
        session.add(rp)

        mem = Membership(user_id=user.id, org_id=org.id, role_id=role.id, status="active")
        session.add(mem)
        await session.commit()

        user_id = user.id
        org_id = org.id

    token = generate_jwt_token({"sub": str(user_id)}, audience=JWT_AUDIENCE_APP)
    async_client.cookies.set("access_token", f"Bearer {token}")

    resp = await async_client.get(f"/app/orgs/{org_id}/permissions")
    assert resp.status_code == 403
    assert resp.json()["code"] == "ORG_SUSPENDED"


@pytest.mark.asyncio
async def test_internal_users_crud_and_lifecycle(async_client, session_factory):
    async with session_factory() as session:
        # Create super admin with user management and staff manage permissions
        admin_role = await setup_platform_role(
            session,
            role_name="super_admin",
            permission_codes=[
                "platform.user.view",
                "platform.user.deactivate",
                "platform.staff.manage",
                "platform.audit.view",
            ],
        )
        # Create support role with user.view and user.deactivate, but NO staff.manage
        support_role = await setup_platform_role(
            session,
            role_name="support_lead",
            permission_codes=[
                "platform.user.view",
                "platform.user.deactivate",
            ],
        )

        admin = User(
            email="admin_lifecycle@stickpeel.internal",
            first_name="Admin",
            last_name="Lifecycle",
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(admin)

        support = User(
            email="support_lifecycle@stickpeel.internal",
            first_name="Support",
            last_name="Lifecycle",
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(support)

        target_staff = User(
            email="staff_target@stickpeel.internal",
            first_name="Staff",
            last_name="Target",
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(target_staff)

        cust = User(
            email="customer_target@example.com",
            first_name="Customer",
            last_name="Target",
            password=hash_password("password123"),
            is_active=True,
            is_admin=False,
        )
        session.add(cust)
        await session.flush()

        pm1 = PlatformMember(user_id=admin.id, role_id=admin_role.id)
        pm2 = PlatformMember(user_id=support.id, role_id=support_role.id)
        pm3 = PlatformMember(user_id=target_staff.id, role_id=support_role.id)
        session.add_all([pm1, pm2, pm3])

        org = Organization(name="Target Customer Org", is_suspended=False)
        session.add(org)
        await session.flush()

        org_role = Role(name="admin", scope="org", is_sys=True)
        session.add(org_role)
        await session.flush()

        mem = Membership(user_id=cust.id, org_id=org.id, role_id=org_role.id, status="active")
        session.add(mem)

        await session.commit()

        admin_id = admin.id
        support_id = support.id
        target_staff_id = target_staff.id
        cust_id = cust.id
        org_id = org.id

    # 1. Test GET /internal/users with filters
    admin_token = generate_jwt_token({"sub": str(admin_id)}, audience=JWT_AUDIENCE_INTERNAL)
    async_client.cookies.set("internal_access_token", f"Bearer {admin_token}")

    # Query with q
    resp_q = await async_client.get("/internal/users?q=customer_target")
    assert resp_q.status_code == 200
    data_q = resp_q.json()
    assert data_q["total"] >= 1
    cust_row = next(u for u in data_q["items"] if u["id"] == str(cust_id))
    assert cust_row["email"] == "customer_target@example.com"
    assert cust_row["first_name"] == "Customer"
    assert cust_row["last_name"] == "Target"
    assert cust_row["is_active"] is True
    assert cust_row["is_staff"] is False
    assert cust_row["org_count"] == 1
    assert "password" not in cust_row
    assert "password_hash" not in cust_row

    # Filter is_staff=true
    resp_staff = await async_client.get("/internal/users?is_staff=true")
    assert resp_staff.status_code == 200
    for u in resp_staff.json()["items"]:
        assert u["is_staff"] is True

    # Filter is_staff=false
    resp_non_staff = await async_client.get("/internal/users?is_staff=false")
    assert resp_non_staff.status_code == 200
    for u in resp_non_staff.json()["items"]:
        assert u["is_staff"] is False

    # 2. Test GET /internal/users/{user_id}
    resp_detail = await async_client.get(f"/internal/users/{cust_id}")
    assert resp_detail.status_code == 200
    detail = resp_detail.json()
    assert detail["id"] == str(cust_id)
    assert len(detail["memberships"]) == 1
    assert detail["memberships"][0]["org_id"] == str(org_id)
    assert detail["memberships"][0]["org_name"] == "Target Customer Org"
    assert detail["memberships"][0]["org_suspended"] is False
    assert detail["memberships"][0]["role"] == "admin"
    assert "password" not in detail
    assert "plans" not in detail

    # 404 for non-existent user
    resp_404 = await async_client.get(f"/internal/users/{uuid.uuid4()}")
    assert resp_404.status_code == 404

    # 3. Test self-deactivation blocked
    resp_self_deact = await async_client.post(
        f"/internal/users/{admin_id}/deactivate",
        json={"reason": "Self deactivation"},
    )
    assert resp_self_deact.status_code == 409

    # 4. Support user attempts to deactivate target_staff (lacks platform.staff.manage)
    support_token = generate_jwt_token({"sub": str(support_id)}, audience=JWT_AUDIENCE_INTERNAL)
    async_client.cookies.set("internal_access_token", f"Bearer {support_token}")

    resp_deact_staff_no_perm = await async_client.post(
        f"/internal/users/{target_staff_id}/deactivate",
        json={"reason": "Attempt without staff.manage"},
    )
    assert resp_deact_staff_no_perm.status_code == 403

    # Support user can deactivate customer user
    resp_deact_cust = await async_client.post(
        f"/internal/users/{cust_id}/deactivate",
        json={"reason": "Customer policy violation"},
    )
    assert resp_deact_cust.status_code == 200
    cust_res_row = resp_deact_cust.json()
    assert cust_res_row["id"] == str(cust_id)
    assert cust_res_row["is_active"] is False

    # Deactivating already inactive -> 409
    resp_deact_inactive = await async_client.post(
        f"/internal/users/{cust_id}/deactivate",
        json={"reason": "Repeat"},
    )
    assert resp_deact_inactive.status_code == 409

    # Check deactivated customer cannot access /app surface
    cust_app_token = generate_jwt_token({"sub": str(cust_id)}, audience=JWT_AUDIENCE_APP)
    async_client.cookies.set("access_token", f"Bearer {cust_app_token}")
    async_client.cookies.delete("internal_access_token")
    resp_app_blocked = await async_client.get(f"/app/orgs/{org_id}/permissions")
    assert resp_app_blocked.status_code == 401

    # Switch back to admin token
    async_client.cookies.delete("access_token")
    async_client.cookies.set("internal_access_token", f"Bearer {admin_token}")

    # 5. Reactivate customer user
    resp_react = await async_client.post(f"/internal/users/{cust_id}/reactivate")
    assert resp_react.status_code == 200
    react_row = resp_react.json()
    assert react_row["id"] == str(cust_id)
    assert react_row["is_active"] is True

    # Reactivating already active -> 409
    resp_react_active = await async_client.post(f"/internal/users/{cust_id}/reactivate")
    assert resp_react_active.status_code == 409

    # Verify audit logs for user.deactivate and user.reactivate
    resp_audits = await async_client.get("/internal/audit-logs")
    assert resp_audits.status_code == 200
    aud_items = resp_audits.json()["items"]
    assert any(a["action"] == "user.deactivate" and a["target_id"] == str(cust_id) for a in aud_items)
    assert any(a["action"] == "user.reactivate" and a["target_id"] == str(cust_id) for a in aud_items)


@pytest.mark.asyncio
async def test_internal_staff_crud_and_guards(async_client, session_factory):
    async with session_factory() as session:
        super_admin_role = await setup_platform_role(
            session,
            role_name="super_admin",
            permission_codes=["platform.staff.manage", "platform.audit.view"],
        )
        operations_role = await setup_platform_role(
            session,
            role_name="operations",
            permission_codes=["platform.audit.view"],
        )
        viewer_role = await setup_platform_role(
            session,
            role_name="viewer",
            permission_codes=[],
        )

        # Create one super_admin user
        admin = User(
            email="staff_admin@stickpeel.internal",
            first_name="Admin",
            last_name="Super",
            password=hash_password("password123"),
            is_active=True,
            is_admin=True,
        )
        session.add(admin)
        await session.flush()

        pm_admin = PlatformMember(user_id=admin.id, role_id=super_admin_role.id)
        session.add(pm_admin)

        # Create regular customer user (not staff)
        customer_user = User(
            email="regular_cust@example.com",
            first_name="Reg",
            last_name="Cust",
            password=hash_password("password123"),
            is_active=True,
            is_admin=False,
        )
        session.add(customer_user)

        await session.commit()
        admin_id = admin.id
        cust_id = customer_user.id

    admin_token = generate_jwt_token({"sub": str(admin_id)}, audience=JWT_AUDIENCE_INTERNAL)
    async_client.cookies.set("internal_access_token", f"Bearer {admin_token}")

    # 1. Validation errors on create
    # Password < 8 characters -> 422
    resp_short_pw = await async_client.post(
        "/internal/staff",
        json={
            "email": "shortpw@stickpeel.internal",
            "password": "short",
            "first_name": "Short",
            "last_name": "Pw",
            "role_name": "viewer",
        },
    )
    assert resp_short_pw.status_code == 422

    # Invalid role name -> 422
    resp_bad_role = await async_client.post(
        "/internal/staff",
        json={
            "email": "badrole@stickpeel.internal",
            "password": "Password123!",
            "first_name": "Bad",
            "last_name": "Role",
            "role_name": "non_existent_role",
        },
    )
    assert resp_bad_role.status_code == 422

    # Duplicate email with existing customer -> 409
    resp_dup = await async_client.post(
        "/internal/staff",
        json={
            "email": "regular_cust@example.com",
            "password": "Password123!",
            "first_name": "Reg",
            "last_name": "Cust",
            "role_name": "viewer",
        },
    )
    assert resp_dup.status_code == 409

    # 2. Successfully create staff user
    new_staff_email = "new_ops@stickpeel.internal"
    resp_create = await async_client.post(
        "/internal/staff",
        json={
            "email": new_staff_email,
            "password": "Password123!",
            "first_name": "New",
            "last_name": "Operations",
            "role_name": "operations",
        },
    )
    assert resp_create.status_code == 201
    created_data = resp_create.json()
    created_user_id = created_data["user_id"]
    assert created_data["email"] == new_staff_email
    assert created_data["role"] == "operations"
    assert created_data["is_active"] is True

    # 3. List staff with filters
    resp_list_q = await async_client.get("/internal/staff?q=Operations")
    assert resp_list_q.status_code == 200
    assert any(s["user_id"] == created_user_id for s in resp_list_q.json()["items"])

    resp_list_role = await async_client.get("/internal/staff?role=operations")
    assert resp_list_role.status_code == 200
    for s in resp_list_role.json()["items"]:
        assert s["role"] == "operations"

    # 4. Get staff member details (includes permissions)
    resp_get = await async_client.get(f"/internal/staff/{created_user_id}")
    assert resp_get.status_code == 200
    detail = resp_get.json()
    assert detail["user_id"] == created_user_id
    assert detail["role"] == "operations"
    assert "permissions" in detail
    assert "platform.audit.view" in detail["permissions"]

    # 404 for non-staff user
    assert (await async_client.get(f"/internal/staff/{cust_id}")).status_code == 404
    assert (await async_client.get(f"/internal/staff/{uuid.uuid4()}")).status_code == 404

    # 5. Patch staff member
    # Self-role change blocked -> 409
    resp_self_patch = await async_client.patch(
        f"/internal/staff/{admin_id}",
        json={"role_name": "viewer"},
    )
    assert resp_self_patch.status_code == 409

    # Cannot demote last active super_admin -> 409
    resp_demote_admin = await async_client.patch(
        f"/internal/staff/{admin_id}",
        json={"role_name": "operations"},
    )
    assert resp_demote_admin.status_code == 409

    # Valid patch on other staff member
    resp_patch_ok = await async_client.patch(
        f"/internal/staff/{created_user_id}",
        json={"first_name": "UpdatedOps", "role_name": "viewer"},
    )
    assert resp_patch_ok.status_code == 200
    assert resp_patch_ok.json()["first_name"] == "UpdatedOps"
    assert resp_patch_ok.json()["role"] == "viewer"

    # Verify user has exactly 1 platform role
    resp_get_after_patch = await async_client.get(f"/internal/staff/{created_user_id}")
    assert resp_get_after_patch.json()["role"] == "viewer"

    # 6. Delete staff member
    # Self-delete blocked -> 409
    assert (await async_client.delete(f"/internal/staff/{admin_id}")).status_code == 409

    # Delete created staff -> 204
    resp_delete = await async_client.delete(f"/internal/staff/{created_user_id}")
    assert resp_delete.status_code == 204

    # User still exists in db but is no longer staff (404 on /internal/staff/{id})
    assert (await async_client.get(f"/internal/staff/{created_user_id}")).status_code == 404

    # Verify audit actions staff.create, staff.update, staff.remove
    resp_audits = await async_client.get("/internal/audit-logs")
    assert resp_audits.status_code == 200
    actions = [a["action"] for a in resp_audits.json()["items"]]
    assert "staff.create" in actions
    assert "staff.update" in actions
    assert "staff.remove" in actions


