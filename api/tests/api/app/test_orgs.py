from __future__ import annotations

import datetime
import uuid
import pytest
from faker import Faker
from sqlalchemy import select

from app.models import Membership, Organization, Permission, Plan, PlanTask, Role, RolePermission, Team, TeamMember, User
from app.security import JWT_AUDIENCE_APP, generate_jwt_token, hash_password

fake = Faker()


async def setup_customer_roles(session) -> dict[str, Role]:
    """Helper to ensure customer roles (owner, admin, member) and permissions exist."""
    role_specs = [
        ("owner", "org", ["org.view", "org.settings", "org.transfer", "org.delete", "member.manage", "team.manage", "org.role.assign", "team.lead.assign"]),
        ("admin", "org", ["org.view", "org.settings", "member.manage", "team.manage", "team.lead.assign"]),
        ("member", "org", ["org.view", "plan.manage_own"]),
        ("team_lead", "team", ["team.view", "plan.view_team", "plan.approve", "plan.return", "team.week.view", "team.history.view"]),
        ("team_member", "team", ["team.view", "plan.create"]),
    ]
    roles: dict[str, Role] = {}
    for rname, scope, perms in role_specs:
        role = (
            await session.execute(
                select(Role).where(
                    Role.name == rname,
                    Role.scope == scope,
                    Role.is_sys.is_(True),
                    Role.org_id.is_(None),
                )
            )
        ).scalar_one_or_none()
        if not role:
            role = Role(name=rname, scope=scope, is_sys=True, org_id=None)
            session.add(role)
            await session.flush()
        roles[rname] = role

        for pcode in perms:
            perm = (
                await session.execute(
                    select(Permission).where(Permission.permission_code == pcode)
                )
            ).scalar_one_or_none()
            if not perm:
                perm = Permission(permission_code=pcode)
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

    await session.commit()
    return roles


async def create_test_user(session, email: str | None = None) -> User:
    user = User(
        first_name=fake.first_name(),
        last_name=fake.last_name(),
        email=email or fake.email().lower(),
        password=hash_password("password123"),
        is_active=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def auth_cookie(user: User) -> dict[str, str]:
    token = generate_jwt_token({"sub": str(user.id)}, audience=JWT_AUDIENCE_APP)
    return {"access_token": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_create_org(async_client, session_factory):
    async with session_factory() as session:
        await setup_customer_roles(session)
        user = await create_test_user(session)

    cookies = auth_cookie(user)
    payload = {
        "name": "Stark Industries",
        "address": "Malibu Point 10880",
        "logo_url": "https://example.com/stark.png",
    }
    resp = await async_client.post("/app/orgs", json=payload, cookies=cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Stark Industries"
    assert data["address"] == "Malibu Point 10880"
    assert data["logo_url"] == "https://example.com/stark.png"
    assert data["role"] == "owner"
    assert "id" in data
    assert "membership_id" in data

    # Verify database state
    async with session_factory() as session:
        org = await session.get(Organization, uuid.UUID(data["id"]))
        assert org is not None
        mem = await session.get(Membership, uuid.UUID(data["membership_id"]))
        assert mem is not None
        assert mem.user_id == user.id
        assert mem.org_id == org.id
        assert mem.status == "active"


@pytest.mark.asyncio
async def test_patch_org_settings(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        owner_user = await create_test_user(session)
        member_user = await create_test_user(session)

        org = Organization(name="Wayne Enterprises", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(
            user_id=owner_user.id,
            org_id=org.id,
            role_id=roles["owner"].id,
            status="active",
        )
        member_mem = Membership(
            user_id=member_user.id,
            org_id=org.id,
            role_id=roles["member"].id,
            status="active",
        )
        session.add_all([owner_mem, member_mem])
        await session.commit()
        org_id = org.id

    # Member lacks org.settings -> 403
    resp_member = await async_client.patch(
        f"/app/orgs/{org_id}",
        json={"name": "Wayne Tech"},
        cookies=auth_cookie(member_user),
    )
    assert resp_member.status_code == 403
    assert resp_member.json()["code"] == "PERMISSION_DENIED"

    # Owner has org.settings -> 200
    resp_owner = await async_client.patch(
        f"/app/orgs/{org_id}",
        json={"name": "Wayne Tech", "address": "Gotham City"},
        cookies=auth_cookie(owner_user),
    )
    assert resp_owner.status_code == 200
    data = resp_owner.json()
    assert data["name"] == "Wayne Tech"
    assert data["address"] == "Gotham City"


@pytest.mark.asyncio
async def test_leave_org_last_owner_rejected(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        owner_user = await create_test_user(session)

        org = Organization(name="Cyberdyne", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(
            user_id=owner_user.id,
            org_id=org.id,
            role_id=roles["owner"].id,
            status="active",
        )
        session.add(owner_mem)
        await session.commit()
        org_id = org.id

    resp = await async_client.post(
        f"/app/orgs/{org_id}/leave",
        cookies=auth_cookie(owner_user),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "LAST_OWNER"


@pytest.mark.asyncio
async def test_leave_org_success_for_member(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        owner_user = await create_test_user(session)
        member_user = await create_test_user(session)

        org = Organization(name="Initech", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(
            user_id=owner_user.id,
            org_id=org.id,
            role_id=roles["owner"].id,
            status="active",
        )
        member_mem = Membership(
            user_id=member_user.id,
            org_id=org.id,
            role_id=roles["member"].id,
            status="active",
        )
        session.add_all([owner_mem, member_mem])
        await session.flush()

        # Add team membership
        team = Team(name="Engineering", org_id=org.id)
        session.add(team)
        await session.flush()

        tm = TeamMember(
            team_id=team.id,
            member_id=member_mem.id,
            org_id=org.id,
            role_id=roles["member"].id,
        )
        session.add(tm)
        await session.commit()
        org_id = org.id
        member_mem_id = member_mem.id

    resp = await async_client.post(
        f"/app/orgs/{org_id}/leave",
        cookies=auth_cookie(member_user),
    )
    assert resp.status_code == 204

    # Verify membership and team membership deleted
    async with session_factory() as session:
        mem = await session.get(Membership, member_mem_id)
        assert mem is None
        tm_rows = (await session.execute(
            select(TeamMember).where(TeamMember.member_id == member_mem_id)
        )).scalars().all()
        assert len(tm_rows) == 0


@pytest.mark.asyncio
async def test_transfer_ownership(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        owner_user = await create_test_user(session)
        colleague_user = await create_test_user(session)

        org = Organization(name="Hooli", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(
            user_id=owner_user.id,
            org_id=org.id,
            role_id=roles["owner"].id,
            status="active",
        )
        colleague_mem = Membership(
            user_id=colleague_user.id,
            org_id=org.id,
            role_id=roles["member"].id,
            status="active",
        )
        session.add_all([owner_mem, colleague_mem])
        await session.commit()
        org_id = org.id
        owner_mem_id = owner_mem.id
        colleague_mem_id = colleague_mem.id

    # Transfer ownership
    resp = await async_client.post(
        f"/app/orgs/{org_id}/transfer-ownership",
        json={"new_owner_member_id": str(colleague_mem_id)},
        cookies=auth_cookie(owner_user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["membership_id"] == str(colleague_mem_id)
    assert data["role"] == "owner"
    assert data["email"] == colleague_user.email

    # Check roles in DB: former owner is admin, new owner is owner
    async with session_factory() as session:
        former_owner = await session.get(Membership, owner_mem_id)
        assert former_owner.role_id == roles["admin"].id
        new_owner = await session.get(Membership, colleague_mem_id)
        assert new_owner.role_id == roles["owner"].id


@pytest.mark.asyncio
async def test_delete_org(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        owner_user = await create_test_user(session)

        org = Organization(name="Pied Piper", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(
            user_id=owner_user.id,
            org_id=org.id,
            role_id=roles["owner"].id,
            status="active",
        )
        session.add(owner_mem)
        await session.commit()
        org_id = org.id

    # Confirmation mismatch -> 422
    resp_bad = await async_client.request(
        "DELETE",
        f"/app/orgs/{org_id}",
        json={"confirm_name": "Aviato"},
        cookies=auth_cookie(owner_user),
    )
    assert resp_bad.status_code == 422
    assert resp_bad.json()["code"] == "CONFIRMATION_MISMATCH"

    # Correct confirmation -> 204
    resp_ok = await async_client.request(
        "DELETE",
        f"/app/orgs/{org_id}",
        json={"confirm_name": "Pied Piper"},
        cookies=auth_cookie(owner_user),
    )
    assert resp_ok.status_code == 204

    # Verify org deleted
    async with session_factory() as session:
        deleted_org = await session.get(Organization, org_id)
        assert deleted_org is None


@pytest.mark.asyncio
async def test_list_org_members(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        owner_user = await create_test_user(session, email="owner@test.com")
        member_user = await create_test_user(session, email="alice@test.com")
        removed_user = await create_test_user(session, email="bob@test.com")

        org = Organization(name="Dunder Mifflin", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(user_id=owner_user.id, org_id=org.id, role_id=roles["owner"].id, status="active")
        member_mem = Membership(user_id=member_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        removed_mem = Membership(user_id=removed_user.id, org_id=org.id, role_id=roles["member"].id, status="removed")
        session.add_all([owner_mem, member_mem, removed_mem])
        await session.commit()
        org_id = org.id

    # List members with owner
    resp = await async_client.get(f"/app/orgs/{org_id}/members", cookies=auth_cookie(owner_user))
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2  # removed user excluded
    assert len(data["items"]) == 2
    emails = [item["email"] for item in data["items"]]
    assert "owner@test.com" in emails
    assert "alice@test.com" in emails
    assert "bob@test.com" not in emails

    # Filter with q
    resp_q = await async_client.get(f"/app/orgs/{org_id}/members?q=alice", cookies=auth_cookie(owner_user))
    assert resp_q.status_code == 200
    assert resp_q.json()["total"] == 1
    assert resp_q.json()["items"][0]["email"] == "alice@test.com"

    # Filter with role
    resp_role = await async_client.get(f"/app/orgs/{org_id}/members?role=member", cookies=auth_cookie(owner_user))
    assert resp_role.status_code == 200
    assert resp_role.json()["total"] == 1
    assert resp_role.json()["items"][0]["role"] == "member"


@pytest.mark.asyncio
async def test_update_member_role(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        owner_user = await create_test_user(session)
        admin_user = await create_test_user(session)
        member_user = await create_test_user(session)

        org = Organization(name="Umbrella Corp", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(user_id=owner_user.id, org_id=org.id, role_id=roles["owner"].id, status="active")
        admin_mem = Membership(user_id=admin_user.id, org_id=org.id, role_id=roles["admin"].id, status="active")
        member_mem = Membership(user_id=member_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        session.add_all([owner_mem, admin_mem, member_mem])
        await session.commit()
        org_id = org.id
        owner_mem_id = owner_mem.id
        member_mem_id = member_mem.id

    # Admin lacks org.role.assign -> 403
    resp_forbidden = await async_client.patch(
        f"/app/orgs/{org_id}/members/{member_mem_id}/role",
        json={"role_name": "admin"},
        cookies=auth_cookie(admin_user),
    )
    assert resp_forbidden.status_code == 403

    # Cannot change own role -> 409
    resp_own = await async_client.patch(
        f"/app/orgs/{org_id}/members/{owner_mem_id}/role",
        json={"role_name": "admin"},
        cookies=auth_cookie(owner_user),
    )
    assert resp_own.status_code == 409
    assert resp_own.json()["code"] == "CANNOT_CHANGE_OWN_ROLE"

    # Cannot target owner -> 409
    resp_target_owner = await async_client.patch(
        f"/app/orgs/{org_id}/members/{owner_mem_id}/role",
        json={"role_name": "member"},
        cookies=auth_cookie(owner_user),
    )
    assert resp_target_owner.status_code == 409

    # Owner promotes member to admin -> 200
    resp_ok = await async_client.patch(
        f"/app/orgs/{org_id}/members/{member_mem_id}/role",
        json={"roleID": str(roles["admin"].id)},
        cookies=auth_cookie(owner_user),
    )
    assert resp_ok.status_code == 200
    data = resp_ok.json()
    assert data["role"] == "admin"

    # Verify DB update
    async with session_factory() as session:
        updated_mem = await session.get(Membership, member_mem_id)
        assert updated_mem.role_id == roles["admin"].id


@pytest.mark.asyncio
async def test_remove_org_member(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        owner_user = await create_test_user(session)
        admin_user = await create_test_user(session)
        member_user = await create_test_user(session)

        org = Organization(name="Starlight", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(user_id=owner_user.id, org_id=org.id, role_id=roles["owner"].id, status="active")
        admin_mem = Membership(user_id=admin_user.id, org_id=org.id, role_id=roles["admin"].id, status="active")
        member_mem = Membership(user_id=member_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        session.add_all([owner_mem, admin_mem, member_mem])
        await session.flush()

        # Member leads a team
        team = Team(name="Alpha Team", org_id=org.id, lead_member_id=member_mem.id)
        session.add(team)
        await session.flush()

        tm = TeamMember(team_id=team.id, member_id=member_mem.id, org_id=org.id, role_id=roles["member"].id)
        session.add(tm)
        await session.commit()
        org_id = org.id
        team_id = team.id
        owner_mem_id = owner_mem.id
        admin_mem_id = admin_mem.id
        member_mem_id = member_mem.id

    # Trying to remove self -> 400
    resp_self = await async_client.delete(
        f"/app/orgs/{org_id}/members/{admin_mem_id}",
        cookies=auth_cookie(admin_user),
    )
    assert resp_self.status_code == 400
    assert resp_self.json()["code"] == "USE_LEAVE_TO_REMOVE_SELF"

    # Trying to remove owner -> 403
    resp_owner = await async_client.delete(
        f"/app/orgs/{org_id}/members/{owner_mem_id}",
        cookies=auth_cookie(admin_user),
    )
    assert resp_owner.status_code == 403
    assert resp_owner.json()["code"] == "CANNOT_REMOVE_OWNER"

    # Admin trying to remove admin -> 403
    resp_admin_remove_admin = await async_client.delete(
        f"/app/orgs/{org_id}/members/{admin_mem_id}",
        cookies=auth_cookie(admin_user),
    )
    # Already caught by self-check, so let's test owner removing admin below.

    # Admin removes member -> 204
    resp_remove = await async_client.delete(
        f"/app/orgs/{org_id}/members/{member_mem_id}",
        cookies=auth_cookie(admin_user),
    )
    assert resp_remove.status_code == 204

    # Verify DB: member row is not deleted, status is 'removed', team.lead_member_id cleared, team_members deleted
    async with session_factory() as session:
        mem = await session.get(Membership, member_mem_id)
        assert mem is not None
        assert mem.status == "removed"

        t = await session.get(Team, team_id)
        assert t.lead_member_id is None

        tms = (await session.execute(
            select(TeamMember).where(TeamMember.member_id == member_mem_id)
        )).scalars().all()
        assert len(tms) == 0

    # Owner removes admin -> 204
    resp_owner_removes_admin = await async_client.delete(
        f"/app/orgs/{org_id}/members/{admin_mem_id}",
        cookies=auth_cookie(owner_user),
    )
    assert resp_owner_removes_admin.status_code == 204


@pytest.mark.asyncio
async def test_update_member_status(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        owner_user = await create_test_user(session)
        member_user = await create_test_user(session)

        org = Organization(name="Oscorp", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(user_id=owner_user.id, org_id=org.id, role_id=roles["owner"].id, status="active")
        member_mem = Membership(user_id=member_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        session.add_all([owner_mem, member_mem])
        await session.commit()
        org_id = org.id
        owner_mem_id = owner_mem.id
        member_mem_id = member_mem.id

    # Cannot suspend self -> 409
    resp_self = await async_client.patch(
        f"/app/orgs/{org_id}/members/{owner_mem_id}/status",
        json={"status": "suspended"},
        cookies=auth_cookie(owner_user),
    )
    assert resp_self.status_code == 409

    # Owner suspends member -> 200
    resp_suspend = await async_client.patch(
        f"/app/orgs/{org_id}/members/{member_mem_id}/status",
        json={"status": "suspended"},
        cookies=auth_cookie(owner_user),
    )
    assert resp_suspend.status_code == 200
    assert resp_suspend.json()["status"] == "suspended"

    # Suspended member is blocked by org dependency -> 403
    resp_blocked = await async_client.get(
        f"/app/orgs/{org_id}/permissions",
        cookies=auth_cookie(member_user),
    )
    assert resp_blocked.status_code == 403


@pytest.mark.asyncio
async def test_create_team(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        admin_user = await create_test_user(session)
        lead_user = await create_test_user(session)

        org = Organization(name="Avengers Initiative", is_suspended=False)
        session.add(org)
        await session.flush()

        admin_mem = Membership(user_id=admin_user.id, org_id=org.id, role_id=roles["admin"].id, status="active")
        lead_mem = Membership(user_id=lead_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        session.add_all([admin_mem, lead_mem])
        await session.commit()
        org_id = org.id
        lead_mem_id = lead_mem.id

    # 1. Create team without lead
    resp_no_lead = await async_client.post(
        f"/app/orgs/{org_id}/teams",
        json={"name": "Alpha"},
        cookies=auth_cookie(admin_user),
    )
    assert resp_no_lead.status_code == 201
    data_no_lead = resp_no_lead.json()
    assert data_no_lead["name"] == "Alpha"
    assert data_no_lead["lead"] is None
    assert data_no_lead["member_count"] == 0

    # 2. Create team with active lead
    resp_lead = await async_client.post(
        f"/app/orgs/{org_id}/teams",
        json={"name": "Bravo", "lead_member_id": str(lead_mem_id)},
        cookies=auth_cookie(admin_user),
    )
    assert resp_lead.status_code == 201
    data_lead = resp_lead.json()
    assert data_lead["name"] == "Bravo"
    assert data_lead["lead"]["membership_id"] == str(lead_mem_id)
    assert data_lead["member_count"] == 1

    # Verify team_members row created with team_lead role
    async with session_factory() as session:
        tm = await session.scalar(
            select(TeamMember).where(
                TeamMember.team_id == uuid.UUID(data_lead["id"]),
                TeamMember.member_id == lead_mem_id,
            )
        )
        assert tm is not None
        assert tm.role_id == roles["team_lead"].id
        assert tm.membership_status == "active"


@pytest.mark.asyncio
async def test_my_teams(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        user = await create_test_user(session)

        org = Organization(name="X-Men", is_suspended=False)
        session.add(org)
        await session.flush()

        mem = Membership(user_id=user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        session.add(mem)
        await session.flush()

        team1 = Team(name="Gold Team", org_id=org.id)
        team2 = Team(name="Blue Team", org_id=org.id)
        team3 = Team(name="Red Team", org_id=org.id)
        session.add_all([team1, team2, team3])
        await session.flush()

        # tm1 active
        tm1 = TeamMember(team_id=team1.id, member_id=mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="active")
        # tm2 suspended
        tm2 = TeamMember(team_id=team2.id, member_id=mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="suspended")
        # tm3 removed
        tm3 = TeamMember(team_id=team3.id, member_id=mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="removed")
        session.add_all([tm1, tm2, tm3])
        await session.commit()
        org_id = org.id

    resp = await async_client.get(f"/app/orgs/{org_id}/my-teams", cookies=auth_cookie(user))
    assert resp.status_code == 200
    data = resp.json()
    # Team3 (removed) should not be returned
    assert len(data) == 2
    team_names = [item["team"]["name"] for item in data]
    assert "Red Team" not in team_names
    assert "Gold Team" in team_names
    assert "Blue Team" in team_names

    gold = next(item for item in data if item["team"]["name"] == "Gold Team")
    blue = next(item for item in data if item["team"]["name"] == "Blue Team")
    assert gold["can_enter"] is True
    assert "plan.create" in gold["permissions"]
    assert "team.view" in gold["permissions"]
    assert blue["can_enter"] is False
    assert blue["membership_status"] == "suspended"


@pytest.mark.asyncio
async def test_get_team_detail_and_members(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        admin_user = await create_test_user(session)
        member1_user = await create_test_user(session, email="m1@test.com")
        member2_user = await create_test_user(session, email="m2@test.com")
        member3_user = await create_test_user(session, email="m3@test.com")

        org = Organization(name="SHIELD", is_suspended=False)
        session.add(org)
        await session.flush()

        admin_mem = Membership(user_id=admin_user.id, org_id=org.id, role_id=roles["admin"].id, status="active")
        m1_mem = Membership(user_id=member1_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        m2_mem = Membership(user_id=member2_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        m3_mem = Membership(user_id=member3_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        session.add_all([admin_mem, m1_mem, m2_mem, m3_mem])
        await session.flush()

        team = Team(name="Strike Team", org_id=org.id, lead_member_id=m1_mem.id)
        session.add(team)
        await session.flush()

        tm1 = TeamMember(team_id=team.id, member_id=m1_mem.id, org_id=org.id, role_id=roles["team_lead"].id, membership_status="active")
        tm2 = TeamMember(team_id=team.id, member_id=m2_mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="suspended")
        tm3 = TeamMember(team_id=team.id, member_id=m3_mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="removed")
        session.add_all([tm1, tm2, tm3])
        await session.commit()
        org_id = org.id
        team_id = team.id

    # Admin gets team detail
    resp = await async_client.get(f"/app/orgs/{org_id}/teams/{team_id}", cookies=auth_cookie(admin_user))
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Strike Team"
    # tm3 (removed) must be excluded
    emails = [m["email"] for m in data["members"]]
    assert "m1@test.com" in emails
    assert "m2@test.com" in emails
    assert "m3@test.com" not in emails

    m2_item = next(m for m in data["members"] if m["email"] == "m2@test.com")
    assert m2_item["membership_status"] == "suspended"

    # List members endpoint
    resp_members = await async_client.get(f"/app/orgs/{org_id}/teams/{team_id}/members", cookies=auth_cookie(admin_user))
    assert resp_members.status_code == 200
    members_data = resp_members.json()
    assert len(members_data) == 2


@pytest.mark.asyncio
async def test_update_and_delete_team(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        admin_user = await create_test_user(session)

        org = Organization(name="Wayne Tech", is_suspended=False)
        session.add(org)
        await session.flush()

        admin_mem = Membership(user_id=admin_user.id, org_id=org.id, role_id=roles["admin"].id, status="active")
        session.add(admin_mem)
        await session.flush()

        team = Team(name="R&D", org_id=org.id)
        session.add(team)
        await session.commit()
        org_id = org.id
        team_id = team.id

    # Update team name
    resp_patch = await async_client.patch(
        f"/app/orgs/{org_id}/teams/{team_id}",
        json={"name": "Applied Sciences"},
        cookies=auth_cookie(admin_user),
    )
    assert resp_patch.status_code == 200
    assert resp_patch.json()["name"] == "Applied Sciences"

    # Delete team
    resp_del = await async_client.delete(f"/app/orgs/{org_id}/teams/{team_id}", cookies=auth_cookie(admin_user))
    assert resp_del.status_code == 204

    # Verify team deleted
    async with session_factory() as session:
        t = await session.get(Team, team_id)
        assert t is None


@pytest.mark.asyncio
async def test_team_members_lifecycle(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        admin_user = await create_test_user(session)
        user = await create_test_user(session)

        org = Organization(name="Stark Labs", is_suspended=False)
        session.add(org)
        await session.flush()

        admin_mem = Membership(user_id=admin_user.id, org_id=org.id, role_id=roles["admin"].id, status="active")
        user_mem = Membership(user_id=user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        session.add_all([admin_mem, user_mem])
        await session.flush()

        team = Team(name="Hardware", org_id=org.id)
        session.add(team)
        await session.commit()
        org_id = org.id
        team_id = team.id
        user_mem_id = user_mem.id

    # 1. Add team member
    resp_add = await async_client.post(
        f"/app/orgs/{org_id}/teams/{team_id}/members",
        json={"member_id": str(user_mem_id)},
        cookies=auth_cookie(admin_user),
    )
    assert resp_add.status_code == 201
    assert resp_add.json()["membership_id"] == str(user_mem_id)
    assert resp_add.json()["team_role"] == "team_member"

    # 2. Add duplicate member -> 409
    resp_dup = await async_client.post(
        f"/app/orgs/{org_id}/teams/{team_id}/members",
        json={"member_id": str(user_mem_id)},
        cookies=auth_cookie(admin_user),
    )
    assert resp_dup.status_code == 409
    assert resp_dup.json()["code"] == "ALREADY_IN_TEAM"

    # 3. Update team member status to suspended
    resp_status = await async_client.patch(
        f"/app/orgs/{org_id}/teams/{team_id}/members/{user_mem_id}",
        json={"status": "suspended"},
        cookies=auth_cookie(admin_user),
    )
    assert resp_status.status_code == 200
    assert resp_status.json()["membership_status"] == "suspended"

    # 4. Remove team member -> 204
    resp_rem = await async_client.delete(
        f"/app/orgs/{org_id}/teams/{team_id}/members/{user_mem_id}",
        cookies=auth_cookie(admin_user),
    )
    assert resp_rem.status_code == 204

    # Verify status is set to removed
    async with session_factory() as session:
        tm = await session.scalar(
            select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.member_id == user_mem_id)
        )
        assert tm is not None
        assert tm.membership_status == "removed"


@pytest.mark.asyncio
async def test_assign_team_lead(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        admin_user = await create_test_user(session)
        old_lead_user = await create_test_user(session)
        new_lead_user = await create_test_user(session)
        outsider_user = await create_test_user(session)

        org = Organization(name="Wakanda Tech", is_suspended=False)
        session.add(org)
        await session.flush()

        admin_mem = Membership(user_id=admin_user.id, org_id=org.id, role_id=roles["admin"].id, status="active")
        old_lead_mem = Membership(user_id=old_lead_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        new_lead_mem = Membership(user_id=new_lead_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        outsider_mem = Membership(user_id=outsider_user.id, org_id=org.id, role_id=roles["member"].id, status="active")
        session.add_all([admin_mem, old_lead_mem, new_lead_mem, outsider_mem])
        await session.flush()

        team = Team(name="Design", org_id=org.id, lead_member_id=old_lead_mem.id)
        session.add(team)
        await session.flush()

        tm_old = TeamMember(team_id=team.id, member_id=old_lead_mem.id, org_id=org.id, role_id=roles["team_lead"].id, membership_status="active")
        tm_new = TeamMember(team_id=team.id, member_id=new_lead_mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="active")
        session.add_all([tm_old, tm_new])
        await session.commit()
        org_id = org.id
        team_id = team.id
        new_lead_mem_id = new_lead_mem.id
        outsider_mem_id = outsider_mem.id

    # Outsider not in team -> 409
    resp_outsider = await async_client.put(
        f"/app/orgs/{org_id}/teams/{team_id}/lead",
        json={"member_id": str(outsider_mem_id)},
        cookies=auth_cookie(admin_user),
    )
    assert resp_outsider.status_code == 409
    assert resp_outsider.json()["code"] == "NOT_IN_TEAM"

    # Assign new lead
    resp_ok = await async_client.put(
        f"/app/orgs/{org_id}/teams/{team_id}/lead",
        json={"member_id": str(new_lead_mem_id)},
        cookies=auth_cookie(admin_user),
    )
    assert resp_ok.status_code == 200
    data = resp_ok.json()
    assert data["lead"]["membership_id"] == str(new_lead_mem_id)

    # Verify DB: old lead is team_member, new lead is team_lead, team.lead_member_id is updated
    async with session_factory() as session:
        t = await session.get(Team, team_id)
        assert t.lead_member_id == new_lead_mem_id

        tm_old_db = await session.scalar(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.member_id == old_lead_mem.id))
        assert tm_old_db.role_id == roles["team_member"].id

        tm_new_db = await session.scalar(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.member_id == new_lead_mem.id))
        assert tm_new_db.role_id == roles["team_lead"].id


@pytest.mark.asyncio
async def test_create_plan_and_validations(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        user = await create_test_user(session)
        other_user = await create_test_user(session)
        org = Organization(name="Plan Test Org", is_suspended=False)
        session.add(org)
        await session.flush()

        mem = Membership(org_id=org.id, user_id=user.id, role_id=roles["member"].id, status="active")
        other_mem = Membership(org_id=org.id, user_id=other_user.id, role_id=roles["member"].id, status="active")
        session.add_all([mem, other_mem])
        await session.flush()

        team = Team(org_id=org.id, name="Frontend Team")
        other_team = Team(org_id=org.id, name="Backend Team")
        session.add_all([team, other_team])
        await session.flush()

        tm = TeamMember(team_id=team.id, member_id=mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="active")
        session.add(tm)
        await session.commit()
        org_id = org.id
        team_id = team.id
        other_team_id = other_team.id

    cookies = auth_cookie(user)

    # 1. Non-Monday week_start_date -> 422
    resp_tue = await async_client.post(
        f"/app/orgs/{org_id}/plans",
        json={
            "team_id": str(team_id),
            "week_start_date": "2026-10-13",  # Tuesday
            "tasks": [],
        },
        cookies=cookies,
    )
    assert resp_tue.status_code == 422
    assert resp_tue.json()["code"] == "INVALID_WEEK_START"

    # 2. Team user doesn't belong to -> 403
    resp_other_team = await async_client.post(
        f"/app/orgs/{org_id}/plans",
        json={
            "team_id": str(other_team_id),
            "week_start_date": "2026-10-12",  # Monday
            "tasks": [],
        },
        cookies=cookies,
    )
    assert resp_other_team.status_code == 403
    assert resp_other_team.json()["code"] == "NOT_TEAM_MEMBER"

    # 3. Multiple main tasks -> 422
    resp_mult_main = await async_client.post(
        f"/app/orgs/{org_id}/plans",
        json={
            "team_id": str(team_id),
            "week_start_date": "2026-10-12",
            "tasks": [
                {"task_type": "main", "title": "Main 1", "why_it_matters": "Why 1", "order_index": 0},
                {"task_type": "main", "title": "Main 2", "why_it_matters": "Why 2", "order_index": 1},
            ],
        },
        cookies=cookies,
    )
    assert resp_mult_main.status_code == 422
    assert resp_mult_main.json()["code"] == "MULTIPLE_MAIN_TASKS"

    # 4. Valid plan creation -> 201
    resp_create = await async_client.post(
        f"/app/orgs/{org_id}/plans",
        json={
            "team_id": str(team_id),
            "week_start_date": "2026-10-12",
            "tasks": [
                {"task_type": "main", "title": "Main 1", "why_it_matters": "Why 1", "order_index": 0},
                {"task_type": "sub", "title": "Sub 1", "order_index": 1},
            ],
        },
        cookies=cookies,
    )
    assert resp_create.status_code == 201
    plan_data = resp_create.json()
    assert plan_data["status"] == "draft"
    assert len(plan_data["tasks"]) == 2
    assert plan_data["week_start_date"] == "2026-10-12"
    plan_id = plan_data["id"]

    # 5. Duplicate for same week -> 409 with existing_plan_id
    resp_dup = await async_client.post(
        f"/app/orgs/{org_id}/plans",
        json={
            "team_id": str(team_id),
            "week_start_date": "2026-10-12",
            "tasks": [],
        },
        cookies=cookies,
    )
    assert resp_dup.status_code == 409
    assert resp_dup.json()["code"] == "PLAN_ALREADY_EXISTS"
    assert resp_dup.json()["existing_plan_id"] == plan_id


@pytest.mark.asyncio
async def test_team_lead_cannot_create_plan_for_own_team(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        lead_user = await create_test_user(session)
        other_user = await create_test_user(session)
        org = Organization(name="Lead Plan Test Org", is_suspended=False)
        session.add(org)
        await session.flush()

        lead_mem = Membership(org_id=org.id, user_id=lead_user.id, role_id=roles["member"].id, status="active")
        other_mem = Membership(org_id=org.id, user_id=other_user.id, role_id=roles["member"].id, status="active")
        session.add_all([lead_mem, other_mem])
        await session.flush()

        # Team 1: lead_user is the team_lead
        lead_team = Team(org_id=org.id, name="Led Team", lead_member_id=lead_mem.id)
        # Team 2: other_user is the team_lead, lead_user is a team_member
        member_team = Team(org_id=org.id, name="Member Team", lead_member_id=other_mem.id)
        session.add_all([lead_team, member_team])
        await session.flush()

        tm_lead = TeamMember(
            team_id=lead_team.id,
            member_id=lead_mem.id,
            org_id=org.id,
            role_id=roles["team_lead"].id,
            membership_status="active",
        )
        tm_member = TeamMember(
            team_id=member_team.id,
            member_id=lead_mem.id,
            org_id=org.id,
            role_id=roles["team_member"].id,
            membership_status="active",
        )
        session.add_all([tm_lead, tm_member])
        await session.commit()
        org_id = org.id
        lead_team_id = lead_team.id
        member_team_id = member_team.id

    cookies = auth_cookie(lead_user)

    # 1. Lead user attempts to create plan for the team they lead -> 403 PERMISSION_DENIED
    resp_lead_create = await async_client.post(
        f"/app/orgs/{org_id}/plans",
        json={
            "team_id": str(lead_team_id),
            "week_start_date": "2026-10-12",
            "tasks": [
                {"task_type": "main", "title": "Lead task", "why_it_matters": "Why", "order_index": 0},
            ],
        },
        cookies=cookies,
    )
    assert resp_lead_create.status_code == 403
    assert resp_lead_create.json()["code"] == "PERMISSION_DENIED"

    # 2. Lead user creates plan for team where they are only a team_member -> 201 Created
    resp_member_create = await async_client.post(
        f"/app/orgs/{org_id}/plans",
        json={
            "team_id": str(member_team_id),
            "week_start_date": "2026-10-12",
            "tasks": [
                {"task_type": "main", "title": "Member task", "why_it_matters": "Why", "order_index": 0},
            ],
        },
        cookies=cookies,
    )
    assert resp_member_create.status_code == 201
    plan_id = resp_member_create.json()["id"]

    # 3. Lead user attempts to update plan's team to the team they lead -> 403 PERMISSION_DENIED
    resp_lead_update = await async_client.put(
        f"/app/orgs/{org_id}/plans/{plan_id}",
        json={
            "team_id": str(lead_team_id),
            "tasks": [
                {"task_type": "main", "title": "Member task", "why_it_matters": "Why", "order_index": 0},
            ],
        },
        cookies=cookies,
    )
    assert resp_lead_update.status_code == 403
    assert resp_lead_update.json()["code"] == "PERMISSION_DENIED"


@pytest.mark.asyncio
async def test_get_and_list_plans(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        user = await create_test_user(session)
        org = Organization(name="List Plan Org", is_suspended=False)
        session.add(org)
        await session.flush()

        mem = Membership(org_id=org.id, user_id=user.id, role_id=roles["member"].id, status="active")
        session.add(mem)
        await session.flush()

        team = Team(org_id=org.id, name="Core Team")
        session.add(team)
        await session.flush()

        tm = TeamMember(team_id=team.id, member_id=mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="active")
        session.add(tm)

        plan = Plan(org_id=org.id, member_id=mem.id, team_id=team.id, week_start_date=datetime.date(2026, 10, 12), status="draft")
        session.add(plan)
        await session.flush()

        task1 = PlanTask(plan_id=plan.id, task_type="main", title="Main task", why_it_matters="Crucial", status="pending", order_index=0)
        task2 = PlanTask(plan_id=plan.id, task_type="sub", title="Sub task", status="done", order_index=1)
        session.add_all([task1, task2])
        await session.commit()
        org_id = org.id
        plan_id = plan.id

    cookies = auth_cookie(user)

    # GET /plans
    resp_list = await async_client.get(f"/app/orgs/{org_id}/plans", cookies=cookies)
    assert resp_list.status_code == 200
    data = resp_list.json()
    assert data["total"] == 1
    assert data["items"][0]["id"] == str(plan_id)
    assert data["items"][0]["task_count"] == 2
    assert data["items"][0]["done_count"] == 1

    # Filter by week_start_date
    resp_filtered = await async_client.get(f"/app/orgs/{org_id}/plans?week_start_date=2026-10-12", cookies=cookies)
    assert resp_filtered.status_code == 200
    assert resp_filtered.json()["total"] == 1

    resp_empty = await async_client.get(f"/app/orgs/{org_id}/plans?week_start_date=2026-10-19", cookies=cookies)
    assert resp_empty.status_code == 200
    assert resp_empty.json()["total"] == 0

    # GET /plans/{plan_id}
    resp_get = await async_client.get(f"/app/orgs/{org_id}/plans/{plan_id}", cookies=cookies)
    assert resp_get.status_code == 200
    assert resp_get.json()["id"] == str(plan_id)
    assert len(resp_get.json()["tasks"]) == 2

    # GET non-existent
    resp_404 = await async_client.get(f"/app/orgs/{org_id}/plans/{uuid.uuid4()}", cookies=cookies)
    assert resp_404.status_code == 404


@pytest.mark.asyncio
async def test_update_plan_put(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        user = await create_test_user(session)
        org = Organization(name="Update Plan Org", is_suspended=False)
        session.add(org)
        await session.flush()

        mem = Membership(org_id=org.id, user_id=user.id, role_id=roles["member"].id, status="active")
        session.add(mem)
        await session.flush()

        team = Team(org_id=org.id, name="Eng Team")
        session.add(team)
        await session.flush()

        tm = TeamMember(team_id=team.id, member_id=mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="active")
        session.add(tm)

        plan = Plan(org_id=org.id, member_id=mem.id, team_id=team.id, week_start_date=datetime.date(2026, 10, 12), status="draft")
        session.add(plan)
        await session.flush()

        task1 = PlanTask(plan_id=plan.id, task_type="main", title="Initial Main", why_it_matters="Old why", status="pending", order_index=0)
        task2 = PlanTask(plan_id=plan.id, task_type="sub", title="Initial Sub", status="pending", order_index=1)
        session.add_all([task1, task2])
        await session.commit()
        org_id = org.id
        plan_id = plan.id
        task1_id = task1.id

    cookies = auth_cookie(user)

    # PUT: update task1, remove task2, add task3
    resp_put = await async_client.put(
        f"/app/orgs/{org_id}/plans/{plan_id}",
        json={
            "tasks": [
                {
                    "id": str(task1_id),
                    "task_type": "main",
                    "title": "Updated Main Task",
                    "why_it_matters": "New why",
                    "order_index": 0,
                },
                {
                    "task_type": "go_to_market",
                    "title": "New GTM Task",
                    "order_index": 1,
                },
            ]
        },
        cookies=cookies,
    )
    assert resp_put.status_code == 200
    put_data = resp_put.json()
    assert len(put_data["tasks"]) == 2
    assert put_data["tasks"][0]["title"] == "Updated Main Task"
    assert put_data["tasks"][1]["title"] == "New GTM Task"
    assert put_data["tasks"][1]["task_type"] == "go_to_market"


@pytest.mark.asyncio
async def test_task_status_toggle_and_complete(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        user = await create_test_user(session)
        org = Organization(name="Task Toggle Org", is_suspended=False)
        session.add(org)
        await session.flush()

        mem = Membership(org_id=org.id, user_id=user.id, role_id=roles["member"].id, status="active")
        session.add(mem)
        await session.flush()

        team = Team(org_id=org.id, name="Ops Team")
        session.add(team)
        await session.flush()

        tm = TeamMember(team_id=team.id, member_id=mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="active")
        session.add(tm)

        plan = Plan(org_id=org.id, member_id=mem.id, team_id=team.id, week_start_date=datetime.date(2026, 10, 12), status="draft")
        session.add(plan)
        await session.flush()

        task1 = PlanTask(plan_id=plan.id, task_type="main", title="Main", why_it_matters="Why", status="pending", order_index=0)
        session.add(task1)
        await session.commit()
        org_id = org.id
        plan_id = plan.id
        task1_id = task1.id

    cookies = auth_cookie(user)

    # 1. PATCH task on draft plan -> 409
    resp_patch_draft = await async_client.patch(
        f"/app/orgs/{org_id}/plans/{plan_id}/tasks/{task1_id}",
        json={"status": "done"},
        cookies=cookies,
    )
    assert resp_patch_draft.status_code == 409
    assert resp_patch_draft.json()["code"] == "PLAN_NOT_APPROVED"

    # Set plan to approved in DB
    async with session_factory() as session:
        p = await session.get(Plan, plan_id)
        p.status = "approved"
        await session.commit()

    # 2. PATCH task on approved plan -> 200
    resp_patch_ok = await async_client.patch(
        f"/app/orgs/{org_id}/plans/{plan_id}/tasks/{task1_id}",
        json={"status": "done"},
        cookies=cookies,
    )
    assert resp_patch_ok.status_code == 200
    assert resp_patch_ok.json()["status"] == "done"

    # 3. POST complete on approved plan -> 200
    resp_complete = await async_client.post(
        f"/app/orgs/{org_id}/plans/{plan_id}/complete",
        json={"main_shipped": True},
        cookies=cookies,
    )
    assert resp_complete.status_code == 200
    assert resp_complete.json()["status"] == "done"
    assert resp_complete.json()["main_shipped"] is True
    assert resp_complete.json()["completed_at"] is not None


@pytest.mark.asyncio
async def test_submit_and_withdraw_plan(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        user = await create_test_user(session)
        org = Organization(name="Submit Withdraw Org", is_suspended=False)
        session.add(org)
        await session.flush()

        mem = Membership(org_id=org.id, user_id=user.id, role_id=roles["member"].id, status="active")
        session.add(mem)
        await session.flush()

        team = Team(org_id=org.id, name="Product Team")
        session.add(team)
        await session.flush()

        tm = TeamMember(team_id=team.id, member_id=mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="active")
        session.add(tm)

        plan = Plan(org_id=org.id, member_id=mem.id, team_id=team.id, week_start_date=datetime.date(2026, 10, 19), status="draft")
        session.add(plan)
        await session.flush()

        # Task without why_it_matters
        task1 = PlanTask(plan_id=plan.id, task_type="main", title="Main without why", why_it_matters="", status="pending", order_index=0)
        session.add(task1)
        await session.commit()
        org_id = org.id
        plan_id = plan.id
        task1_id = task1.id

    cookies = auth_cookie(user)

    # 1. Submit without why_it_matters -> 422
    resp_submit_invalid = await async_client.post(
        f"/app/orgs/{org_id}/plans/{plan_id}/submit",
        cookies=cookies,
    )
    assert resp_submit_invalid.status_code == 422
    assert resp_submit_invalid.json()["code"] == "WHY_IT_MATTERS_REQUIRED"

    # Fix why_it_matters
    async with session_factory() as session:
        t = await session.get(PlanTask, task1_id)
        t.why_it_matters = "Because users depend on it"
        await session.commit()

    # 2. Submit valid -> 200
    resp_submit_ok = await async_client.post(
        f"/app/orgs/{org_id}/plans/{plan_id}/submit",
        cookies=cookies,
    )
    assert resp_submit_ok.status_code == 200
    assert resp_submit_ok.json()["status"] == "submitted"
    assert resp_submit_ok.json()["submitted_at"] is not None

    # 3. Withdraw submitted plan -> 200
    resp_withdraw = await async_client.post(
        f"/app/orgs/{org_id}/plans/{plan_id}/withdraw",
        cookies=cookies,
    )
    assert resp_withdraw.status_code == 200
    assert resp_withdraw.json()["status"] == "draft"
    assert resp_withdraw.json()["submitted_at"] is None


@pytest.mark.asyncio
async def test_delete_plan_and_replace(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_customer_roles(session)
        user = await create_test_user(session)
        org = Organization(name="Delete Plan Org", is_suspended=False)
        session.add(org)
        await session.flush()

        mem = Membership(org_id=org.id, user_id=user.id, role_id=roles["member"].id, status="active")
        session.add(mem)
        await session.flush()

        team = Team(org_id=org.id, name="Security Team")
        session.add(team)
        await session.flush()

        tm = TeamMember(team_id=team.id, member_id=mem.id, org_id=org.id, role_id=roles["team_member"].id, membership_status="active")
        session.add(tm)

        draft_plan = Plan(org_id=org.id, member_id=mem.id, team_id=team.id, week_start_date=datetime.date(2026, 10, 12), status="draft")
        approved_plan = Plan(org_id=org.id, member_id=mem.id, team_id=team.id, week_start_date=datetime.date(2026, 10, 19), status="approved")
        replacement_draft = Plan(org_id=org.id, member_id=mem.id, team_id=team.id, week_start_date=datetime.date(2026, 10, 26), status="draft")
        session.add_all([draft_plan, approved_plan, replacement_draft])
        await session.commit()
        org_id = org.id
        draft_plan_id = draft_plan.id
        approved_plan_id = approved_plan.id
        replacement_draft_id = replacement_draft.id

    cookies = auth_cookie(user)

    # 1. Delete draft plan without replacement -> 204
    resp_del_draft = await async_client.delete(f"/app/orgs/{org_id}/plans/{draft_plan_id}", cookies=cookies)
    assert resp_del_draft.status_code == 204

    # 2. Delete approved plan without replacement -> 409
    resp_del_app_err = await async_client.delete(f"/app/orgs/{org_id}/plans/{approved_plan_id}", cookies=cookies)
    assert resp_del_app_err.status_code == 409
    assert resp_del_app_err.json()["code"] == "CANNOT_DELETE_NON_DRAFT"

    # 3. Delete approved plan with replacement draft plan -> 204
    resp_replace = await async_client.request(
        "DELETE",
        f"/app/orgs/{org_id}/plans/{approved_plan_id}",
        json={"new_plan_id_approving": str(replacement_draft_id)},
        cookies=cookies,
    )
    assert resp_replace.status_code == 204

    # Verify DB: approved plan deleted, replacement_draft now has week_start_date 2026-10-19
    async with session_factory() as session:
        del_check = await session.get(Plan, approved_plan_id)
        assert del_check is None
        rep_check = await session.get(Plan, replacement_draft_id)
        assert rep_check is not None
        assert rep_check.week_start_date == datetime.date(2026, 10, 19)



