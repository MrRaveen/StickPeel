import asyncio
import datetime
import inspect
import secrets
from functools import partial, wraps

from pydantic import ValidationError
from sqlalchemy import select
from typer import BadParameter, Option, Typer

from app.cli.schemas import UserCreate
from app.database import AsyncSessionLocal, async_engine
from app.models import (
    AICall,
    Invitation,
    Membership,
    Organization,
    Permission,
    Plan,
    PlanTask,
    PlatformMember,
    Role,
    RolePermission,
    StaffAuditLog,
    Team,
    TeamMember,
    User,
)
from app.security import hash_password


class AsyncTyper(Typer):
    @staticmethod
    def maybe_run_async(decorator, f):
        if inspect.iscoroutinefunction(f):

            @wraps(f)
            def runner(*args, **kwargs):
                async def main():
                    try:
                        return await f(*args, **kwargs)
                    finally:
                        await session.close()
                        await async_engine.dispose()

                return asyncio.run(main())

            decorator(runner)
        else:
            decorator(f)
        return f

    def callback(self, *args, **kwargs):
        decorator = super().callback(*args, **kwargs)
        return partial(self.maybe_run_async, decorator)

    def command(self, *args, **kwargs):
        decorator = super().command(*args, **kwargs)
        return partial(self.maybe_run_async, decorator)


session = AsyncSessionLocal()
cli = AsyncTyper()


@cli.callback()
def main():
    """StickPeel management CLI."""


@cli.command()
async def create_user(
    first_name: str = Option(...),
    last_name: str = Option(...),
    email: str = Option(...),
    password: str = Option(None, help="Login password. Generated if not given."),
    admin: bool = Option(False, "--admin", help="Grant admin privileges."),
):
    """Create a user.

    The login password is generated unless provided with --password.
    Pass --admin to grant admin privileges.
    """
    try:
        data = UserCreate(first_name=first_name, last_name=last_name, email=email)
    except ValidationError as e:
        raise BadParameter("; ".join(err["msg"] for err in e.errors()))

    existing = (
        (await session.execute(select(User).where(User.email == data.email)))
        .scalars()
        .first()
    )
    if existing:
        raise BadParameter(f"User with email '{data.email}' already exists.")

    generated = password is None
    if generated:
        password = secrets.token_urlsafe(12)

    user = User(
        **data.model_dump(),
        password=hash_password(password),
        is_active=True,
        is_admin=admin,
    )
    session.add(user)
    await session.flush()

    if admin:
        super_admin_role = (
            await session.execute(
                select(Role).where(
                    Role.name == "super_admin",
                    Role.scope == "platform",
                    Role.is_sys.is_(True),
                )
            )
        ).scalar_one_or_none()
        if super_admin_role:
            pm = (
                await session.execute(
                    select(PlatformMember).where(
                        PlatformMember.user_id == user.id,
                        PlatformMember.role_id == super_admin_role.id,
                    )
                )
            ).scalar_one_or_none()
            if not pm:
                session.add(
                    PlatformMember(user_id=user.id, role_id=super_admin_role.id)
                )

    await session.commit()
    print(f"{'Admin' if admin else 'User'} created: ", user.id)
    if generated:
        print("Generated password: ", password)


@cli.command()
async def seed():
    """Seed system roles, permissions, and demo organizations/users/plans (idempotent)."""
    # 1. Seed Permissions
    # Customer org/team permissions
    customer_permissions = [
        "org.view",
        "plan.manage_own",
        "plan.ai_use",
        "invite.manage",
        "member.manage",
        "org.settings",
        "team.manage",
        "team.lead.assign",
        "org.role.assign",
        "org.transfer",
        "org.delete",
        "team.view",
        "plan.create",
        "plan.view_team",
        "plan.approve",
        "plan.return",
        "team.week.view",
        "team.history.view",
    ]
    # Platform permissions
    platform_permissions = [
        "platform.org.view",
        "platform.org.suspend",
        "platform.user.view",
        "platform.user.deactivate",
        "platform.ai_usage.view",
        "platform.staff.manage",
        "platform.audit.view",
    ]

    permissions_list = customer_permissions + platform_permissions
    perm_map: dict[str, Permission] = {}
    for code in permissions_list:
        existing = (
            await session.execute(
                select(Permission).where(Permission.permission_code == code)
            )
        ).scalar_one_or_none()
        if not existing:
            existing = Permission(permission_code=code)
            session.add(existing)
            await session.flush()
        perm_map[code] = existing

    # 2. Seed System Roles
    # Customer roles
    member_perms = {"org.view", "plan.manage_own", "plan.ai_use"}
    admin_perms = member_perms | {
        "invite.manage",
        "member.manage",
        "org.settings",
        "team.manage",
        "team.lead.assign",
    }
    owner_perms = admin_perms | {"org.role.assign", "org.transfer", "org.delete"}
    team_member_perms = {"team.view", "plan.create"}
    team_lead_perms = {
        "team.view",
        "plan.view_team",
        "plan.approve",
        "plan.return",
        "team.week.view",
        "team.history.view",
    }

    # Platform roles
    # viewer: platform.org.view, platform.user.view, platform.ai_usage.view
    # support: viewer + platform.user.deactivate (minus platform.ai_usage.view) -> platform.org.view, platform.user.view, platform.user.deactivate
    # operations: platform.org.view, platform.org.suspend, platform.user.view, platform.user.deactivate, platform.ai_usage.view, platform.audit.view
    # super_admin: all 7 platform permissions
    platform_viewer_perms = {
        "platform.org.view",
        "platform.user.view",
        "platform.ai_usage.view",
    }
    platform_support_perms = {
        "platform.org.view",
        "platform.user.view",
        "platform.user.deactivate",
    }
    platform_operations_perms = {
        "platform.org.view",
        "platform.org.suspend",
        "platform.user.view",
        "platform.user.deactivate",
        "platform.ai_usage.view",
        "platform.audit.view",
    }
    platform_super_admin_perms = set(platform_permissions)

    role_specs = [
        # Customer roles (scope='org' and scope='team')
        ("owner", "org", owner_perms),
        ("admin", "org", admin_perms),
        ("member", "org", member_perms),
        ("team_lead", "team", team_lead_perms),
        ("team_member", "team", team_member_perms),
        # Platform roles (scope='platform')
        ("super_admin", "platform", platform_super_admin_perms),
        ("operations", "platform", platform_operations_perms),
        ("support", "platform", platform_support_perms),
        ("viewer", "platform", platform_viewer_perms),
    ]

    roles_map: dict[str, Role] = {}
    for role_name, scope, perms in role_specs:
        existing_role = (
            await session.execute(
                select(Role).where(
                    Role.name == role_name,
                    Role.scope == scope,
                    Role.is_sys.is_(True),
                    Role.org_id.is_(None),
                )
            )
        ).scalar_one_or_none()
        if not existing_role:
            existing_role = Role(name=role_name, scope=scope, is_sys=True, org_id=None)
            session.add(existing_role)
            await session.flush()
        roles_map[role_name] = existing_role

        # Map role permissions
        for pcode in perms:
            perm_obj = perm_map[pcode]
            rp_existing = (
                await session.execute(
                    select(RolePermission).where(
                        RolePermission.role_id == existing_role.id,
                        RolePermission.permission_id == perm_obj.id,
                    )
                )
            ).scalar_one_or_none()
            if not rp_existing:
                session.add(
                    RolePermission(
                        role_id=existing_role.id, permission_id=perm_obj.id
                    )
                )

    await session.flush()

    # 3. Seed Users
    # - Staff user: staff@stickpeel.internal (password: StaffPass123!) -> is_admin=True, platform super_admin
    # - Staff operations: ops@stickpeel.internal (password: StaffPass123!) -> is_admin=True, platform operations
    # - Acme Owner: owner@acme.com (password: DemoPass123!)
    # - Acme Lead & Beta Member: lead@acme.com (password: DemoPass123!)
    # - Acme Member: dev@acme.com (password: DemoPass123!)
    # - Beta Owner: owner@beta.com (password: DemoPass123!)
    users_data = [
        ("Platform", "Staff", "staff@stickpeel.internal", "StaffPass123!", True, True),
        ("Platform", "Ops", "ops@stickpeel.internal", "StaffPass123!", True, True),
        ("Acme", "Owner", "owner@acme.com", "DemoPass123!", False, True),
        ("Team", "Lead", "lead@acme.com", "DemoPass123!", False, True),
        ("Senior", "Dev", "dev@acme.com", "DemoPass123!", False, True),
        ("Beta", "Owner", "owner@beta.com", "DemoPass123!", False, True),
        ("Inactive", "User", "inactive@acme.com", "DemoPass123!", False, False),
    ]

    user_map: dict[str, User] = {}
    for fname, lname, email, pwd, is_adm, is_act in users_data:
        usr = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if not usr:
            usr = User(
                first_name=fname,
                last_name=lname,
                email=email,
                password=hash_password(pwd),
                is_active=is_act,
                is_admin=is_adm,
            )
            session.add(usr)
            await session.flush()
        else:
            usr.is_active = is_act
            usr.is_admin = is_adm
        user_map[email] = usr

    # 4. Platform Members
    platform_member_specs = [
        ("staff@stickpeel.internal", "super_admin"),
        ("ops@stickpeel.internal", "operations"),
    ]
    for email, rname in platform_member_specs:
        u = user_map[email]
        r = roles_map[rname]
        pm = (
            await session.execute(
                select(PlatformMember).where(
                    PlatformMember.user_id == u.id,
                    PlatformMember.role_id == r.id,
                )
            )
        ).scalar_one_or_none()
        if not pm:
            pm = PlatformMember(user_id=u.id, role_id=r.id)
            session.add(pm)

    # 5. Seed Organizations
    now = datetime.datetime.now(datetime.timezone.utc)
    org_specs = [
        ("Acme Corp", False, "100 Innovation Way, Suite 400", None, now),
        ("Beta Labs", False, "200 Research Blvd, Cambridge", None, now - datetime.timedelta(hours=2)),
        ("Gamma Solutions", True, "50 Sunset Blvd, Austin", None, now - datetime.timedelta(days=35)),
    ]
    org_map: dict[str, Organization] = {}
    for name, is_susp, addr, logo, last_act in org_specs:
        org = (
            await session.execute(
                select(Organization).where(Organization.name == name)
            )
        ).scalar_one_or_none()
        if not org:
            org = Organization(
                name=name,
                is_suspended=is_susp,
                address=addr,
                logo_url=logo,
                last_active_at=last_act,
            )
            session.add(org)
            await session.flush()
        else:
            if org.last_active_at is None:
                org.last_active_at = last_act
        org_map[name] = org

    acme_org = org_map["Acme Corp"]
    beta_org = org_map["Beta Labs"]
    gamma_org = org_map["Gamma Solutions"]

    # 6. Memberships
    membership_specs = [
        ("owner@acme.com", acme_org.id, "owner", "active"),
        ("lead@acme.com", acme_org.id, "admin", "active"),
        ("dev@acme.com", acme_org.id, "member", "active"),
        ("inactive@acme.com", acme_org.id, "member", "active"),
        ("owner@beta.com", beta_org.id, "owner", "active"),
        ("lead@acme.com", beta_org.id, "member", "active"),
        ("owner@acme.com", gamma_org.id, "owner", "suspended"),
    ]

    membership_map: dict[tuple[str, str], Membership] = {}
    for email, org_id, rname, m_status in membership_specs:
        u = user_map[email]
        r = roles_map[rname]
        m = (
            await session.execute(
                select(Membership).where(
                    Membership.user_id == u.id, Membership.org_id == org_id
                )
            )
        ).scalar_one_or_none()
        if not m:
            m = Membership(
                user_id=u.id, org_id=org_id, role_id=r.id, status=m_status
            )
            session.add(m)
            await session.flush()
        membership_map[(email, str(org_id))] = m

    # 7. Teams & Team Members
    acme_owner_membership = membership_map[("owner@acme.com", str(acme_org.id))]
    acme_lead_membership = membership_map[("lead@acme.com", str(acme_org.id))]
    acme_dev_membership = membership_map[("dev@acme.com", str(acme_org.id))]
    beta_owner_membership = membership_map[("owner@beta.com", str(beta_org.id))]
    beta_lead_membership = membership_map[("lead@acme.com", str(beta_org.id))]

    teams_data = [
        (acme_org.id, "Core Platform", acme_lead_membership.id, [
            (acme_lead_membership, "team_lead"),
            (acme_dev_membership, "team_member"),
        ]),
        (acme_org.id, "Product Growth", acme_owner_membership.id, [
            (acme_owner_membership, "team_lead"),
            (acme_lead_membership, "team_member"),
        ]),
        (beta_org.id, "R&D Engine", beta_owner_membership.id, [
            (beta_owner_membership, "team_lead"),
            (beta_lead_membership, "team_member"),
        ]),
    ]

    teams_map: dict[str, Team] = {}
    for org_id, t_name, lead_mid, t_members in teams_data:
        team_obj = (
            await session.execute(
                select(Team).where(Team.org_id == org_id, Team.name == t_name)
            )
        ).scalar_one_or_none()
        if not team_obj:
            team_obj = Team(
                org_id=org_id,
                name=t_name,
                lead_member_id=lead_mid,
            )
            session.add(team_obj)
            await session.flush()
        teams_map[t_name] = team_obj

        for mem, rname in t_members:
            tm = (
                await session.execute(
                    select(TeamMember).where(
                        TeamMember.team_id == team_obj.id,
                        TeamMember.member_id == mem.id,
                    )
                )
            ).scalar_one_or_none()
            if not tm:
                tm = TeamMember(
                    team_id=team_obj.id,
                    member_id=mem.id,
                    role_id=roles_map[rname].id,
                    org_id=org_id,
                    membership_status="active",
                )
                session.add(tm)

    team_core = teams_map["Core Platform"]
    team_growth = teams_map["Product Growth"]
    team_rd = teams_map["R&D Engine"]

    # 8. Invitations
    invitations_data = [
        (acme_org.id, "demo-invite-token-acme", "newhire@acme.com", user_map["owner@acme.com"].id),
        (beta_org.id, "demo-invite-token-beta", "researcher@beta.com", user_map["owner@beta.com"].id),
    ]
    for org_id, inv_tok, inv_email, inv_creator in invitations_data:
        existing_inv = (
            await session.execute(
                select(Invitation).where(Invitation.token == inv_tok)
            )
        ).scalar_one_or_none()
        if not existing_inv:
            inv = Invitation(
                org_id=org_id,
                token=inv_tok,
                link=f"/join?token={inv_tok}",
                role_id=roles_map["member"].id,
                email=inv_email,
                created_by=inv_creator,
                active_status="pending",
                expires_at=now + datetime.timedelta(days=7),
            )
            session.add(inv)

    # 9. Plans & Tasks across multiple weeks
    today = datetime.date.today()
    monday_current = today - datetime.timedelta(days=today.weekday())
    monday_prev1 = monday_current - datetime.timedelta(days=7)
    monday_prev2 = monday_current - datetime.timedelta(days=14)
    monday_prev3 = monday_current - datetime.timedelta(days=21)

    plans_specs = [
        # Plan 1: 3 weeks ago - Done, main shipped
        {
            "org_id": acme_org.id,
            "member_id": acme_dev_membership.id,
            "team_id": team_core.id,
            "week_start_date": monday_prev3,
            "status": "done",
            "lead_comment": None,
            "submitted_at": datetime.datetime.combine(monday_prev3, datetime.time(9, 0), tzinfo=datetime.timezone.utc),
            "approved_at": datetime.datetime.combine(monday_prev3, datetime.time(14, 30), tzinfo=datetime.timezone.utc),
            "approved_by_member_id": acme_lead_membership.id,
            "completed_at": datetime.datetime.combine(monday_prev3 + datetime.timedelta(days=4), datetime.time(17, 0), tzinfo=datetime.timezone.utc),
            "main_shipped": True,
            "tasks": [
                {
                    "task_type": "main",
                    "why_it_matters": "Critical for handling user authentications reliably without session drops",
                    "title": "Migrate session auth to stateless JWT bearer authentication",
                    "description": "Verified across staging and tested with all token refresh flows",
                    "status": "done",
                    "order_index": 0,
                },
                {
                    "task_type": "sub",
                    "why_it_matters": None,
                    "title": "Implement audience and signature verification in dependency",
                    "description": None,
                    "status": "done",
                    "order_index": 1,
                },
                {
                    "task_type": "sub",
                    "why_it_matters": None,
                    "title": "Add automated test suite for expired and invalid tokens",
                    "description": None,
                    "status": "done",
                    "order_index": 2,
                },
                {
                    "task_type": "go_to_market",
                    "why_it_matters": None,
                    "title": "Update internal API documentation and changelog entry",
                    "description": None,
                    "status": "done",
                    "order_index": 3,
                },
            ],
        },
        # Plan 2: 2 weeks ago - Done, main NOT shipped
        {
            "org_id": acme_org.id,
            "member_id": acme_dev_membership.id,
            "team_id": team_core.id,
            "week_start_date": monday_prev2,
            "status": "done",
            "lead_comment": "Good progress on utilities, but keep scope manageable so release blockers don't spill past Friday.",
            "submitted_at": datetime.datetime.combine(monday_prev2, datetime.time(9, 15), tzinfo=datetime.timezone.utc),
            "approved_at": datetime.datetime.combine(monday_prev2, datetime.time(15, 0), tzinfo=datetime.timezone.utc),
            "approved_by_member_id": acme_lead_membership.id,
            "completed_at": datetime.datetime.combine(monday_prev2 + datetime.timedelta(days=4), datetime.time(18, 30), tzinfo=datetime.timezone.utc),
            "main_shipped": False,
            "tasks": [
                {
                    "task_type": "main",
                    "why_it_matters": "Allows tenants to configure custom webhook notification endpoints",
                    "title": "Deliver outbound webhook retry worker and signing secret generator",
                    "description": "Worker hit memory timeout under dead-letter queue spike",
                    "status": "pending",
                    "order_index": 0,
                },
                {
                    "task_type": "sub",
                    "why_it_matters": None,
                    "title": "Implement HMAC-SHA256 signature calculation utility",
                    "description": None,
                    "status": "done",
                    "order_index": 1,
                },
                {
                    "task_type": "go_to_market",
                    "why_it_matters": None,
                    "title": "Publish webhook developer guide in documentation",
                    "description": None,
                    "status": "pending",
                    "order_index": 2,
                },
            ],
        },
        # Plan 3: 1 week ago - Approved
        {
            "org_id": acme_org.id,
            "member_id": acme_dev_membership.id,
            "team_id": team_core.id,
            "week_start_date": monday_prev1,
            "status": "approved",
            "lead_comment": None,
            "submitted_at": datetime.datetime.combine(monday_prev1, datetime.time(8, 45), tzinfo=datetime.timezone.utc),
            "approved_at": datetime.datetime.combine(monday_prev1, datetime.time(11, 20), tzinfo=datetime.timezone.utc),
            "approved_by_member_id": acme_lead_membership.id,
            "completed_at": None,
            "main_shipped": None,
            "tasks": [
                {
                    "task_type": "main",
                    "why_it_matters": "Prevent duplicate invites and handle expired invitation links gracefully",
                    "title": "Complete invite acceptance and tenant auto-enrollment",
                    "description": "Verified token lookup, user link, and membership creation",
                    "status": "done",
                    "order_index": 0,
                },
                {
                    "task_type": "sub",
                    "why_it_matters": None,
                    "title": "Add rate limit protection on public invite token verification",
                    "description": None,
                    "status": "done",
                    "order_index": 1,
                },
                {
                    "task_type": "go_to_market",
                    "why_it_matters": None,
                    "title": "Trigger invite_accepted event to Mixpanel analytics",
                    "description": None,
                    "status": "pending",
                    "order_index": 2,
                },
            ],
        },
        # Plan 4: Current week - Submitted
        {
            "org_id": acme_org.id,
            "member_id": acme_dev_membership.id,
            "team_id": team_core.id,
            "week_start_date": monday_current,
            "status": "submitted",
            "lead_comment": None,
            "submitted_at": datetime.datetime.combine(monday_current, datetime.time(9, 30), tzinfo=datetime.timezone.utc),
            "approved_at": None,
            "approved_by_member_id": None,
            "completed_at": None,
            "main_shipped": None,
            "tasks": [
                {
                    "task_type": "main",
                    "why_it_matters": "Ensures customers can securely invite team members and set permissions",
                    "title": "Implement invitation acceptance workflow and role assignment",
                    "description": "Accept flow validates token expiry and links user to org",
                    "status": "pending",
                    "order_index": 0,
                },
                {
                    "task_type": "sub",
                    "why_it_matters": None,
                    "title": "Build invitation validation service and endpoint with tenancy check",
                    "description": None,
                    "status": "pending",
                    "order_index": 1,
                },
                {
                    "task_type": "go_to_market",
                    "why_it_matters": None,
                    "title": "Add PostHog telemetry event for invite_accepted",
                    "description": None,
                    "status": "pending",
                    "order_index": 2,
                },
            ],
        },
        # Plan 5: Current week - Draft (Product Growth)
        {
            "org_id": acme_org.id,
            "member_id": acme_lead_membership.id,
            "team_id": team_growth.id,
            "week_start_date": monday_current,
            "status": "draft",
            "lead_comment": None,
            "submitted_at": None,
            "approved_at": None,
            "approved_by_member_id": None,
            "completed_at": None,
            "main_shipped": None,
            "tasks": [
                {
                    "task_type": "main",
                    "why_it_matters": "Improve org onboarding conversion by simplifying the first plan creation wizard",
                    "title": "Redesign weekly onboarding empty state and AI drafter prompt helper",
                    "description": "Guide users step-by-step to draft their first plan",
                    "status": "pending",
                    "order_index": 0,
                },
                {
                    "task_type": "sub",
                    "why_it_matters": None,
                    "title": "Wire TanStack query caching on AI prompt suggestions",
                    "description": None,
                    "status": "pending",
                    "order_index": 1,
                },
                {
                    "task_type": "go_to_market",
                    "why_it_matters": None,
                    "title": "Add interactive walkthrough banner on dashboard",
                    "description": None,
                    "status": "pending",
                    "order_index": 2,
                },
            ],
        },
        # Plan 6: 1 week ago - Draft (Returned with lead comment in Beta Labs)
        {
            "org_id": beta_org.id,
            "member_id": beta_lead_membership.id,
            "team_id": team_rd.id,
            "week_start_date": monday_prev1,
            "status": "draft",
            "lead_comment": "Break down the benchmarking scripts into separate reproducible runs.",
            "submitted_at": datetime.datetime.combine(monday_prev1, datetime.time(8, 0), tzinfo=datetime.timezone.utc),
            "approved_at": None,
            "approved_by_member_id": None,
            "completed_at": None,
            "main_shipped": None,
            "returned_at": datetime.datetime.combine(monday_prev1 + datetime.timedelta(days=1), datetime.time(10, 0), tzinfo=datetime.timezone.utc),
            "tasks": [
                {
                    "task_type": "main",
                    "why_it_matters": "Enable high-throughput background processing for telemetry",
                    "title": "Benchmark Postgres JSONB indexing vs Redis caching layer",
                    "description": "Compare query latency under 10k concurrent simulated events",
                    "status": "pending",
                    "order_index": 0,
                },
                {
                    "task_type": "sub",
                    "why_it_matters": None,
                    "title": "Execute pgbench load test scenarios",
                    "description": None,
                    "status": "pending",
                    "order_index": 1,
                },
            ],
        },
    ]

    plan_entities: list[Plan] = []
    for spec in plans_specs:
        plan_obj = (
            await session.execute(
                select(Plan).where(
                    Plan.member_id == spec["member_id"],
                    Plan.org_id == spec["org_id"],
                    Plan.week_start_date == spec["week_start_date"],
                )
            )
        ).scalar_one_or_none()

        tasks_data = spec["tasks"]
        if not plan_obj:
            plan_obj = Plan(
                org_id=spec["org_id"],
                member_id=spec["member_id"],
                team_id=spec["team_id"],
                week_start_date=spec["week_start_date"],
                status=spec["status"],
                lead_comment=spec["lead_comment"],
                submitted_at=spec["submitted_at"],
                approved_at=spec["approved_at"],
                approved_by_member_id=spec["approved_by_member_id"],
                completed_at=spec["completed_at"],
                main_shipped=spec["main_shipped"],
                returned_at=spec.get("returned_at"),
            )
            session.add(plan_obj)
            await session.flush()

            for t in tasks_data:
                session.add(PlanTask(plan_id=plan_obj.id, **t))
        else:
            # Update existing plan with full lifecycle metadata if missing
            if plan_obj.status != spec["status"]:
                plan_obj.status = spec["status"]
            if plan_obj.main_shipped is None and spec["main_shipped"] is not None:
                plan_obj.main_shipped = spec["main_shipped"]
            if plan_obj.lead_comment is None and spec["lead_comment"] is not None:
                plan_obj.lead_comment = spec["lead_comment"]
            if plan_obj.approved_by_member_id is None and spec["approved_by_member_id"] is not None:
                plan_obj.approved_by_member_id = spec["approved_by_member_id"]

            # Ensure tasks exist
            existing_task_count = (
                await session.execute(
                    select(PlanTask).where(PlanTask.plan_id == plan_obj.id)
                )
            ).scalars().all()
            if not existing_task_count:
                for t in tasks_data:
                    session.add(PlanTask(plan_id=plan_obj.id, **t))

        plan_entities.append(plan_obj)

    # 10. Seed AI Calls (with mixed statuses for internal analytics)
    # Statuses: 'success', 'failed', 'rate_limited', 'timeout', 'invalid_output'
    ai_calls_specs = [
        {
            "org_id": acme_org.id,
            "user_id": user_map["dev@acme.com"].id,
            "plan_id": plan_entities[3].id,  # Current submitted plan
            "feature": "plan_review",
            "model": "gemini-2.5-flash-lite",
            "status": "success",
            "error_type": None,
            "latency_ms": 1140,
            "input_tokens": 645,
            "output_tokens": 230,
        },
        {
            "org_id": acme_org.id,
            "user_id": user_map["dev@acme.com"].id,
            "plan_id": None,
            "feature": "plan_draft",
            "model": "gemini-2.5-flash-lite",
            "status": "success",
            "error_type": None,
            "latency_ms": 920,
            "input_tokens": 410,
            "output_tokens": 275,
        },
        {
            "org_id": acme_org.id,
            "user_id": user_map["dev@acme.com"].id,
            "plan_id": plan_entities[3].id,
            "feature": "plan_review",
            "model": "gemini-2.5-flash-lite",
            "status": "rate_limited",
            "error_type": "RateLimitExceeded",
            "latency_ms": 120,
            "input_tokens": 0,
            "output_tokens": 0,
        },
        {
            "org_id": acme_org.id,
            "user_id": user_map["lead@acme.com"].id,
            "plan_id": None,
            "feature": "plan_review",
            "model": "gemini-2.5-flash-lite",
            "status": "timeout",
            "error_type": "TimeoutException",
            "latency_ms": 10000,
            "input_tokens": 710,
            "output_tokens": 0,
        },
        {
            "org_id": beta_org.id,
            "user_id": user_map["lead@acme.com"].id,
            "plan_id": None,
            "feature": "plan_draft",
            "model": "gemini-2.5-flash-lite",
            "status": "failed",
            "error_type": "InternalServerError",
            "latency_ms": 380,
            "input_tokens": 320,
            "output_tokens": 0,
        },
        {
            "org_id": beta_org.id,
            "user_id": user_map["owner@beta.com"].id,
            "plan_id": None,
            "feature": "plan_review",
            "model": "gemini-2.5-flash-lite",
            "status": "invalid_output",
            "error_type": "OutputValidationError",
            "latency_ms": 1450,
            "input_tokens": 820,
            "output_tokens": 140,
        },
    ]

    for call_data in ai_calls_specs:
        existing_call = (
            await session.execute(
                select(AICall).where(
                    AICall.org_id == call_data["org_id"],
                    AICall.user_id == call_data["user_id"],
                    AICall.feature == call_data["feature"],
                    AICall.status == call_data["status"],
                )
            )
        ).scalar_one_or_none()
        if not existing_call:
            session.add(AICall(**call_data))

    # 11. Seed Staff Audit Logs
    staff_user = user_map["staff@stickpeel.internal"]
    ops_user = user_map["ops@stickpeel.internal"]
    audit_specs = [
        {
            "staff_user_id": staff_user.id,
            "action": "org.suspend",
            "target_type": "organization",
            "target_id": str(gamma_org.id),
            "detail": "Account suspended due to extended inactivity and unverified ownership",
        },
        {
            "staff_user_id": ops_user.id,
            "action": "org.reinstate",
            "target_type": "organization",
            "target_id": str(beta_org.id),
            "detail": "Reinstated organization following compliance verification",
        },
        {
            "staff_user_id": staff_user.id,
            "action": "user.deactivate",
            "target_type": "user",
            "target_id": str(user_map["inactive@acme.com"].id),
            "detail": "Deactivated account per customer organization owner request",
        },
        {
            "staff_user_id": staff_user.id,
            "action": "staff.create",
            "target_type": "platform_member",
            "target_id": str(ops_user.id),
            "detail": "Assigned operations platform role to ops staff",
        },
    ]

    for audit_data in audit_specs:
        existing_audit = (
            await session.execute(
                select(StaffAuditLog).where(
                    StaffAuditLog.staff_user_id == audit_data["staff_user_id"],
                    StaffAuditLog.action == audit_data["action"],
                    StaffAuditLog.target_id == audit_data["target_id"],
                )
            )
        ).scalar_one_or_none()
        if not existing_audit:
            session.add(StaffAuditLog(**audit_data))

    await session.commit()
    print("Database seeding completed successfully.")
