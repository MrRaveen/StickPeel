from __future__ import annotations

import datetime
import uuid
import pytest
from sqlalchemy import select

from app.models import Membership, Organization, Permission, Role, RolePermission, User, Invitation
from app.security import JWT_AUDIENCE_APP, generate_jwt_token, hash_password


async def setup_roles(session) -> dict[str, Role]:
    role_specs = [
        ("owner", "org", ["org.view", "invite.manage", "member.manage"]),
        ("admin", "org", ["org.view", "invite.manage", "member.manage"]),
        ("member", "org", ["org.view"]),
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
                session.add(RolePermission(role_id=role.id, permission_id=perm.id))
    await session.commit()
    return roles


def auth_cookie(user: User) -> dict[str, str]:
    token = generate_jwt_token({"sub": str(user.id)}, audience=JWT_AUDIENCE_APP)
    return {"access_token": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_invitation_lifecycle(async_client, session_factory):
    async with session_factory() as session:
        roles = await setup_roles(session)
        owner_user = User(first_name="Org", last_name="Owner", email=f"owner-{uuid.uuid4()}@test.com", password=hash_password("Pass123!"), is_active=True)
        admin_user = User(first_name="Org", last_name="Admin", email=f"admin-{uuid.uuid4()}@test.com", password=hash_password("Pass123!"), is_active=True)
        member_user = User(first_name="Org", last_name="Member", email=f"member-{uuid.uuid4()}@test.com", password=hash_password("Pass123!"), is_active=True)
        invitee_user = User(first_name="New", last_name="Hire", email=f"newhire-{uuid.uuid4()}@test.com", password=hash_password("Pass123!"), is_active=True)
        session.add_all([owner_user, admin_user, member_user, invitee_user])
        await session.flush()

        org = Organization(name="Invite Test Org", is_suspended=False)
        session.add(org)
        await session.flush()

        owner_mem = Membership(org_id=org.id, user_id=owner_user.id, role_id=roles["owner"].id, status="active")
        admin_mem = Membership(org_id=org.id, user_id=admin_user.id, role_id=roles["admin"].id, status="active")
        member_mem = Membership(org_id=org.id, user_id=member_user.id, role_id=roles["member"].id, status="active")
        session.add_all([owner_mem, admin_mem, member_mem])
        await session.commit()
        org_id = org.id

    owner_cookies = auth_cookie(owner_user)
    admin_cookies = auth_cookie(admin_user)
    member_cookies = auth_cookie(member_user)
    invitee_cookies = auth_cookie(invitee_user)

    # 1. Member cannot invite (no invite.manage) -> 403
    resp_no_perm = await async_client.post(
        f"/app/orgs/{org_id}/invitations",
        json={"email": "anyone@test.com", "role_name": "member"},
        cookies=member_cookies,
    )
    assert resp_no_perm.status_code == 403

    # 2. Admin cannot invite admin -> 403 not_allowed
    resp_admin_invite_admin = await async_client.post(
        f"/app/orgs/{org_id}/invitations",
        json={"email": "futureadmin@test.com", "role_name": "admin"},
        cookies=admin_cookies,
    )
    assert resp_admin_invite_admin.status_code == 403
    assert resp_admin_invite_admin.json()["code"] == "not_allowed"

    # 3. Inviting owner role -> 422
    resp_invite_owner = await async_client.post(
        f"/app/orgs/{org_id}/invitations",
        json={"email": "futureowner@test.com", "role_name": "owner"},
        cookies=owner_cookies,
    )
    assert resp_invite_owner.status_code == 422

    # 4. Inviting existing member -> 409 already_member
    resp_invite_existing = await async_client.post(
        f"/app/orgs/{org_id}/invitations",
        json={"email": member_user.email, "role_name": "member"},
        cookies=owner_cookies,
    )
    assert resp_invite_existing.status_code == 409
    assert resp_invite_existing.json()["code"] == "already_member"

    # 5. Owner invites admin successfully -> 201
    resp_owner_invite_admin = await async_client.post(
        f"/app/orgs/{org_id}/invitations",
        json={"email": "secondadmin@test.com", "role_name": "admin"},
        cookies=owner_cookies,
    )
    assert resp_owner_invite_admin.status_code == 201
    admin_inv_data = resp_owner_invite_admin.json()
    assert admin_inv_data["role_name"] == "admin"
    assert admin_inv_data["status"] == "pending"
    assert "/accept-invite?token=" in admin_inv_data["link"]

    # 6. Admin creates member invitation -> 201
    resp_create = await async_client.post(
        f"/app/orgs/{org_id}/invitations",
        json={"email": invitee_user.email, "role_name": "member"},
        cookies=admin_cookies,
    )
    assert resp_create.status_code == 201
    inv_data = resp_create.json()
    assert inv_data["role_name"] == "member"
    assert inv_data["status"] == "pending"
    inv_id = inv_data["id"]
    token = inv_data["link"].split("token=")[1]
    assert len(token) == 43

    # 7. Duplicate pending invitation -> 409 invitation_exists
    resp_dup = await async_client.post(
        f"/app/orgs/{org_id}/invitations",
        json={"email": invitee_user.email, "role_name": "member"},
        cookies=admin_cookies,
    )
    assert resp_dup.status_code == 409
    assert resp_dup.json()["code"] == "invitation_exists"

    # 8. List invitations -> 200
    resp_list = await async_client.get(
        f"/app/orgs/{org_id}/invitations",
        cookies=admin_cookies,
    )
    assert resp_list.status_code == 200
    list_data = resp_list.json()
    assert list_data["total"] >= 2
    items = list_data["items"]
    assert any(item["id"] == inv_id for item in items)

    # 9. Admin attempts to renew admin invitation -> 403 not_allowed
    resp_admin_renew_admin = await async_client.post(
        f"/app/orgs/{org_id}/invitations/{admin_inv_data['id']}/renew",
        cookies=admin_cookies,
    )
    assert resp_admin_renew_admin.status_code == 403
    assert resp_admin_renew_admin.json()["code"] == "not_allowed"

    # 10. Owner renews admin invitation -> 200 with new link
    resp_owner_renew = await async_client.post(
        f"/app/orgs/{org_id}/invitations/{admin_inv_data['id']}/renew",
        cookies=owner_cookies,
    )
    assert resp_owner_renew.status_code == 200
    assert resp_owner_renew.json()["link"] != admin_inv_data["link"]

    # 11. Public token lookup (unauthenticated) -> 200
    resp_public = await async_client.get(f"/app/invitations/{token}")
    assert resp_public.status_code == 200
    pub_data = resp_public.json()
    assert pub_data["organization_name"] == "Invite Test Org"
    assert pub_data["role_name"] == "member"
    assert "***" in pub_data["masked_email"]

    # 12. Public lookup with invalid token length -> 404
    resp_bad_token = await async_client.get("/app/invitations/short-token")
    assert resp_bad_token.status_code == 404
    assert resp_bad_token.json()["code"] == "invitation_invalid"

    # 13. Accept invitation while already a member -> 409 already_member
    resp_owner_accept = await async_client.post(
        f"/app/invitations/{token}/accept",
        cookies=owner_cookies,
    )
    assert resp_owner_accept.status_code == 409
    assert resp_owner_accept.json()["code"] == "already_member"

    # 14. Successful accept by invitee -> 201 AcceptOut
    resp_accept = await async_client.post(
        f"/app/invitations/{token}/accept",
        cookies=invitee_cookies,
    )
    assert resp_accept.status_code == 201
    accept_data = resp_accept.json()
    assert accept_data["role_name"] == "member"
    assert accept_data["organization"]["id"] == str(org_id)
    assert "membership_id" in accept_data

    # 15. Re-accept accepted invitation -> 404 invitation_invalid
    resp_reaccept = await async_client.post(
        f"/app/invitations/{token}/accept",
        cookies=invitee_cookies,
    )
    assert resp_reaccept.status_code == 404
    assert resp_reaccept.json()["code"] == "invitation_invalid"

    # 16. Public lookup on accepted token -> 404 invitation_invalid
    resp_pub_accepted = await async_client.get(f"/app/invitations/{token}")
    assert resp_pub_accepted.status_code == 404
    assert resp_pub_accepted.json()["code"] == "invitation_invalid"

    # 17. Cancel invitation
    # Create another invite to cancel
    resp_to_cancel = await async_client.post(
        f"/app/orgs/{org_id}/invitations",
        json={"email": "tocancel@test.com", "role_name": "member"},
        cookies=admin_cookies,
    )
    assert resp_to_cancel.status_code == 201
    cancel_id = resp_to_cancel.json()["id"]
    cancel_tok = resp_to_cancel.json()["link"].split("token=")[1]

    resp_del = await async_client.delete(
        f"/app/orgs/{org_id}/invitations/{cancel_id}",
        cookies=admin_cookies,
    )
    assert resp_del.status_code == 204

    # Cancelled token public lookup -> 404
    resp_pub_cancelled = await async_client.get(f"/app/invitations/{cancel_tok}")
    assert resp_pub_cancelled.status_code == 404
