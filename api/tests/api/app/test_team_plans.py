from __future__ import annotations

import datetime
import uuid
import pytest
from faker import Faker
from sqlalchemy import select

from app.models import Membership, Organization, Permission, Plan, PlanTask, Role, RolePermission, Team, TeamMember, User
from app.security import JWT_AUDIENCE_APP, generate_jwt_token, hash_password
from tests.api.app.test_orgs import create_test_user, setup_customer_roles

fake = Faker()


def get_next_monday() -> datetime.date:
    today = datetime.date.today()
    days_ahead = (0 - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return today + datetime.timedelta(days=days_ahead)


@pytest.fixture
def auth_headers():
    def _headers(user: User) -> dict[str, str]:
        token = generate_jwt_token({"sub": str(user.id)}, audience=JWT_AUDIENCE_APP)
        return {
            "Authorization": f"Bearer {token}",
            "Cookie": f"access_token=Bearer {token}",
        }
    return _headers


@pytest.fixture
async def async_db_session(session_factory):
    async with session_factory() as session:
        yield session


@pytest.mark.asyncio
async def test_team_lead_plan_lifecycle_and_rbac(async_client, async_db_session, auth_headers):
    roles = await setup_customer_roles(async_db_session)

    # 1. Setup Org, Owner, Lead, and Member
    org = Organization(name="Lead Test Org")
    async_db_session.add(org)
    await async_db_session.commit()
    await async_db_session.refresh(org)

    owner_user = await create_test_user(async_db_session)
    lead_user = await create_test_user(async_db_session)
    member_user = await create_test_user(async_db_session)
    other_user = await create_test_user(async_db_session)

    owner_mem = Membership(user_id=owner_user.id, org_id=org.id, role_id=roles["owner"].id)
    lead_mem = Membership(user_id=lead_user.id, org_id=org.id, role_id=roles["member"].id)
    member_mem = Membership(user_id=member_user.id, org_id=org.id, role_id=roles["member"].id)
    other_mem = Membership(user_id=other_user.id, org_id=org.id, role_id=roles["member"].id)
    async_db_session.add_all([owner_mem, lead_mem, member_mem, other_mem])
    await async_db_session.commit()
    await async_db_session.refresh(lead_mem)
    await async_db_session.refresh(member_mem)
    await async_db_session.refresh(other_mem)

    # Team A with Lead and Member
    team_a = Team(org_id=org.id, name="Engineering Alpha", lead_member_id=lead_mem.id)
    async_db_session.add(team_a)
    await async_db_session.commit()
    await async_db_session.refresh(team_a)

    tm_lead = TeamMember(team_id=team_a.id, member_id=lead_mem.id, role_id=roles["team_lead"].id, org_id=org.id)
    tm_member = TeamMember(team_id=team_a.id, member_id=member_mem.id, role_id=roles["team_member"].id, org_id=org.id)
    async_db_session.add_all([tm_lead, tm_member])
    await async_db_session.commit()

    monday = get_next_monday()

    # 2. Member creates a draft plan with tasks and submits it
    resp_create = await async_client.post(
        f"/app/orgs/{org.id}/plans",
        headers=auth_headers(member_user),
        json={
            "team_id": str(team_a.id),
            "week_start_date": monday.isoformat(),
            "tasks": [
                {
                    "task_type": "main",
                    "title": "Main Goal 1",
                    "why_it_matters": "Critical impact",
                    "order_index": 0,
                },
                {
                    "task_type": "sub",
                    "title": "Sub task 1",
                    "order_index": 1,
                },
            ],
        },
    )
    assert resp_create.status_code == 201
    plan_id = resp_create.json()["id"]

    # In draft status: lead cannot see it in team plans list
    resp_lead_list = await async_client.get(
        f"/app/orgs/{org.id}/teams/{team_a.id}/plans",
        headers=auth_headers(lead_user),
    )
    assert resp_lead_list.status_code == 200
    assert resp_lead_list.json()["total"] == 0

    # In draft status: lead cannot view details (404)
    resp_lead_get = await async_client.get(
        f"/app/orgs/{org.id}/teams/{team_a.id}/plans/{plan_id}",
        headers=auth_headers(lead_user),
    )
    assert resp_lead_get.status_code == 404

    # Member submits the plan
    resp_submit = await async_client.post(
        f"/app/orgs/{org.id}/plans/{plan_id}/submit",
        headers=auth_headers(member_user),
    )
    assert resp_submit.status_code == 200
    assert resp_submit.json()["status"] == "submitted"

    # Now team lead can see it in team plans list
    resp_lead_list2 = await async_client.get(
        f"/app/orgs/{org.id}/teams/{team_a.id}/plans",
        headers=auth_headers(lead_user),
    )
    assert resp_lead_list2.status_code == 200
    assert resp_lead_list2.json()["total"] == 1
    item = resp_lead_list2.json()["items"][0]
    assert item["id"] == plan_id
    assert item["author"]["member_id"] == str(member_mem.id)
    assert item["author"]["first_name"] == member_user.first_name

    # Team lead can get details
    resp_lead_get2 = await async_client.get(
        f"/app/orgs/{org.id}/teams/{team_a.id}/plans/{plan_id}",
        headers=auth_headers(lead_user),
    )
    assert resp_lead_get2.status_code == 200
    assert resp_lead_get2.json()["status"] == "submitted"
    assert len(resp_lead_get2.json()["tasks"]) == 2

    # Non-lead (member_user) cannot call approve
    resp_unauth_approve = await async_client.post(
        f"/app/orgs/{org.id}/teams/{team_a.id}/plans/{plan_id}/approve",
        headers=auth_headers(member_user),
    )
    assert resp_unauth_approve.status_code == 403

    # Team lead returns the plan with feedback
    resp_return = await async_client.post(
        f"/app/orgs/{org.id}/teams/{team_a.id}/plans/{plan_id}/return",
        headers=auth_headers(lead_user),
        json={"comment": "Please add more details to sub task 1"},
    )
    assert resp_return.status_code == 200
    ret_plan = resp_return.json()
    assert ret_plan["status"] == "draft"
    assert ret_plan["lead_comment"] == "Please add more details to sub task 1"
    assert ret_plan["returned_at"] is not None

    # Plan is now in draft status: invisible to team lead (404 PLAN_NOT_FOUND)
    resp_bad_approve = await async_client.post(
        f"/app/orgs/{org.id}/teams/{team_a.id}/plans/{plan_id}/approve",
        headers=auth_headers(lead_user),
    )
    assert resp_bad_approve.status_code == 404
    assert resp_bad_approve.json()["code"] == "PLAN_NOT_FOUND"

    # Author resubmits the plan
    resp_submit2 = await async_client.post(
        f"/app/orgs/{org.id}/plans/{plan_id}/submit",
        headers=auth_headers(member_user),
    )
    assert resp_submit2.status_code == 200
    assert resp_submit2.json()["status"] == "submitted"

    # Team lead approves the plan
    resp_approve = await async_client.post(
        f"/app/orgs/{org.id}/teams/{team_a.id}/plans/{plan_id}/approve",
        headers=auth_headers(lead_user),
    )
    assert resp_approve.status_code == 200
    appr_plan = resp_approve.json()
    assert appr_plan["status"] == "approved"
    assert appr_plan["approved_by"] == str(lead_mem.id)
    assert appr_plan["approved_at"] is not None


@pytest.mark.asyncio
async def test_team_lead_cannot_approve_own_plan(async_client, async_db_session, auth_headers):
    roles = await setup_customer_roles(async_db_session)

    org = Organization(name="Self Approve Org")
    async_db_session.add(org)
    await async_db_session.commit()

    lead_user = await create_test_user(async_db_session)
    lead_mem = Membership(user_id=lead_user.id, org_id=org.id, role_id=roles["member"].id)
    async_db_session.add(lead_mem)
    await async_db_session.commit()

    team = Team(org_id=org.id, name="Self Team", lead_member_id=lead_mem.id)
    async_db_session.add(team)
    await async_db_session.commit()

    tm_lead = TeamMember(team_id=team.id, member_id=lead_mem.id, role_id=roles["team_lead"].id, org_id=org.id)
    async_db_session.add(tm_lead)
    await async_db_session.commit()

    monday = get_next_monday()

    # Manually insert a submitted plan authored by the lead
    lead_plan = Plan(
        org_id=org.id,
        member_id=lead_mem.id,
        team_id=team.id,
        week_start_date=monday,
        status="submitted",
    )
    async_db_session.add(lead_plan)
    await async_db_session.commit()

    # Lead tries to approve their own plan -> 403 CANNOT_APPROVE_OWN_PLAN
    resp_approve = await async_client.post(
        f"/app/orgs/{org.id}/teams/{team.id}/plans/{lead_plan.id}/approve",
        headers=auth_headers(lead_user),
    )
    assert resp_approve.status_code == 403
    assert resp_approve.json()["code"] == "CANNOT_APPROVE_OWN_PLAN"

    # Lead tries to return their own plan -> 403 CANNOT_RETURN_OWN_PLAN
    resp_return = await async_client.post(
        f"/app/orgs/{org.id}/teams/{team.id}/plans/{lead_plan.id}/return",
        headers=auth_headers(lead_user),
        json={"comment": "Self return"},
    )
    assert resp_return.status_code == 403
    assert resp_return.json()["code"] == "CANNOT_RETURN_OWN_PLAN"


@pytest.mark.asyncio
async def test_team_lead_week_and_history_views(async_client, async_db_session, auth_headers):
    roles = await setup_customer_roles(async_db_session)

    org = Organization(name="Views Org")
    async_db_session.add(org)
    await async_db_session.commit()

    lead_user = await create_test_user(async_db_session)
    member_user = await create_test_user(async_db_session)
    no_plan_user = await create_test_user(async_db_session)

    lead_mem = Membership(user_id=lead_user.id, org_id=org.id, role_id=roles["member"].id)
    member_mem = Membership(user_id=member_user.id, org_id=org.id, role_id=roles["member"].id)
    no_plan_mem = Membership(user_id=no_plan_user.id, org_id=org.id, role_id=roles["member"].id)
    async_db_session.add_all([lead_mem, member_mem, no_plan_mem])
    await async_db_session.commit()

    team = Team(org_id=org.id, name="View Team", lead_member_id=lead_mem.id)
    async_db_session.add(team)
    await async_db_session.commit()

    tm1 = TeamMember(team_id=team.id, member_id=lead_mem.id, role_id=roles["team_lead"].id, org_id=org.id)
    tm2 = TeamMember(team_id=team.id, member_id=member_mem.id, role_id=roles["team_member"].id, org_id=org.id)
    tm3 = TeamMember(team_id=team.id, member_id=no_plan_mem.id, role_id=roles["team_member"].id, org_id=org.id)
    async_db_session.add_all([tm1, tm2, tm3])
    await async_db_session.commit()

    monday = get_next_monday()

    # Plan for member_user is submitted with tasks
    plan = Plan(
        org_id=org.id,
        member_id=member_mem.id,
        team_id=team.id,
        week_start_date=monday,
        status="submitted",
    )
    async_db_session.add(plan)
    await async_db_session.flush()

    task1 = PlanTask(plan_id=plan.id, task_type="main", title="Outcome 1", status="done", order_index=0)
    task2 = PlanTask(plan_id=plan.id, task_type="sub", title="Sub 1", status="pending", order_index=1)
    async_db_session.add_all([task1, task2])
    await async_db_session.commit()

    # GET /week with valid Monday
    resp_week = await async_client.get(
        f"/app/orgs/{org.id}/teams/{team.id}/week?week_start_date={monday.isoformat()}",
        headers=auth_headers(lead_user),
    )
    assert resp_week.status_code == 200
    data = resp_week.json()
    assert data["week_start_date"] == monday.isoformat()
    assert data["totals"]["members"] == 3
    assert data["totals"]["submitted"] == 1
    assert data["totals"]["no_plan"] == 2

    # Check non-Monday validation error
    tuesday = monday + datetime.timedelta(days=1)
    resp_bad_week = await async_client.get(
        f"/app/orgs/{org.id}/teams/{team.id}/week?week_start_date={tuesday.isoformat()}",
        headers=auth_headers(lead_user),
    )
    assert resp_bad_week.status_code == 400
    assert resp_bad_week.json()["code"] == "INVALID_WEEK_START_DATE"

    # GET /history
    resp_hist = await async_client.get(
        f"/app/orgs/{org.id}/teams/{team.id}/history",
        headers=auth_headers(lead_user),
    )
    assert resp_hist.status_code == 200
    hist_data = resp_hist.json()
    assert "items" in hist_data
    assert "total" in hist_data
