# Complete route design for StickPeel

This is based on the models you pasted. **Member ids in paths are membership ids** (`memberships.id`), because your `Plan`, `TeamMember` and `Team.lead_member_id` all point to memberships. I named the path param `{member_id}` everywhere.

## 0. Model changes you need first

Several routes below can't work without these.

1. **`plans`**: add `lead_comment` (Text, null), `submitted_at`, `returned_at`, `approved_at`, `completed_at` (DateTime, null), `approved_by_member_id` (FK memberships, null) and `main_shipped` (Boolean, null).
2. **`plan_tasks`**: add a partial unique index, one row with `task_type = 'main'` per plan (`postgresql_where`).
3. **`organizations`**: add `last_active_at` (DateTime, null). The admin panel needs "last active", and today nothing stores it.
4. **`invitations`**: add `expires_at` (DateTime, null).
5. **New `ai_calls`**: `id`, `org_id`, `user_id`, `plan_id` (null), `feature` (`plan_review` / `plan_draft`), `model`, `status` (`success` / `failed` / `rate_limited` / `timeout` / `invalid_output`), `error_type`, `latency_ms`, `input_tokens`, `output_tokens`, `created_at`. No prompt or plan text. Skip this if the table already exists outside the files you pasted.
6. **New `staff_audit_logs`**: `id`, `staff_user_id`, `action`, `target_type`, `target_id`, `created_at`. No customer content. Add it only if you keep `platform.audit.view`; otherwise remove that permission.

**Naming fix:** your model uses `task_type = 'sub'`, but AGENTS.md says `sub_goal`. Use `sub` and update AGENTS.md. Also update AGENTS.md to say plans belong to `member_id` (a membership), not `user_id`.

## 1. Rules for every route

- IDs are UUIDs. Lists use `?page=1&page_size=20` (max 100) and return `{items, total, page, page_size}`.
- Errors return `{code, message}`:
  - 401: not logged in or inactive user
  - 403: logged in but not allowed
  - 404: not found, or the row is in another org
  - 409: wrong state or conflict
  - 422: validation
- Every `/app/orgs/{org_id}/...` route goes through `require_org_permission`:
  1. User is active.
  2. Membership exists for (user, `org_id`) with `status = 'active'`.
  3. `Organization.is_suspended` is false.
  4. The role has the permission code.
  5. Update `org.last_active_at`, at most once every few minutes.
- Team routes also run `require_team_permission`: load the team by (`team_id`, `org_id`), find the caller's `team_members` row, check the code.
- Load every row by (`id`, `org_id`). For plan tasks, join through the plan, since `plan_tasks` has no `org_id`.
- Services flush, routers commit.
- Every request schema uses `extra="forbid"`.
- "Author only" means `plan.member_id == caller's membership id`. Anyone else gets 404.

## 2. Shared shapes

- **OrgOut**: `id, name, address, logo_url, is_suspended, created_at`
- **MemberOut**: `membership_id, user_id, email, first_name, last_name, role, status, joined_at`
- **TeamOut**: `id, name, lead {membership_id, first_name, last_name} or null, member_count`
- **TeamMemberOut**: `membership_id, first_name, last_name, email, team_role`
- **InviteOut**: `id, email, role, active_status, link, expires_at, created_at`
- **TaskIn**: `id?, task_type (main / sub / go_to_market), title (1-255), description?, why_it_matters?, order_index`
- **TaskOut**: `id, task_type, title, description, why_it_matters, status (pending / done), order_index`
- **PlanOut**: `id, team_id, week_start_date, status, lead_comment, returned_at, submitted_at, approved_at, approved_by, main_shipped, completed_at, tasks[TaskOut], created_at, updated_at`
- **PlanSummary**: `id, team_id, week_start_date, status, task_count, done_count, main_shipped`

## 3. Customer routes (`/app`) still to build

### 3.1 Organizations

| # | Route | Permission (scope) | Input | Output |
|---|---|---|---|---|
| 1 | `POST /app/orgs` | Authenticated | body: `name, address?, logo_url?` | 201 OrgOut + `role: "owner"`, `membership_id` |
| 2 | `GET /app/orgs/{org_id}` | `org.view` (org) | none | OrgOut + `my_role` |
| 3 | `PATCH /app/orgs/{org_id}` | `org.settings` (org) | body: `name?, address?, logo_url?` | OrgOut |
| 4 | `POST /app/orgs/{org_id}/leave` | `org.view` (org) | none | 204 |
| 5 | `POST /app/orgs/{org_id}/transfer-ownership` | `org.transfer` (org) | body: `new_owner_member_id` | 200 MemberOut (new owner) |
| 6 | `DELETE /app/orgs/{org_id}` | `org.delete` (org) | body: `confirm_name` | 204 (optional, skip if short on time) |

Rules:
- #1: creating the org and the owner membership happen in one transaction. The role is the system `owner` role (`scope='org'`, `org_id` null).
- #4: if the caller is the last owner, return 409. Leaving deletes their membership, team rows and plans (see decisions at the end).
- #5: the target must be an active member of the same org. The old owner becomes `admin`.

### 3.2 Invitations

Your `Invitation` model is per email, so accepting must check the email.

| # | Route | Permission (scope) | Input | Output |
|---|---|---|---|---|
| 7 | `POST /app/orgs/{org_id}/invites` | `invite.manage` (org) | body: `email, role_name` (`admin` / `member`) | 201 InviteOut with `link` |
| 8 | `GET /app/orgs/{org_id}/invites` | `invite.manage` (org) | query: `active_status?`, page | Page of InviteOut |
| 9 | `DELETE /app/orgs/{org_id}/invites/{invite_id}` | `invite.manage` (org) | none | 204 (sets `cancelled`) |
| 10 | `GET /app/invites/{token}` | Public | none | `org_name, org_logo_url, role, masked_email, status, expired` |
| 11 | `POST /app/invites/{token}/accept` | Authenticated | none | OrgOut + `role` |

Rules:
- #7:
  - Never allow the `owner` role.
  - Only an owner (has `org.role.assign`) can invite an `admin`.
  - Return 409 if the email is already a member or has a pending invite.
  - Token is `secrets.token_urlsafe(32)`. `link` is `{APP_URL}/invite/{token}`. `expires_at` is now + 7 days.
- #9: only `pending` invites can be cancelled.
- #10: never return the full email or other org data.
- #11:
  - The invite must be `pending` and not expired.
  - The caller's email must match `invitation.email`, case-insensitive. Otherwise 403.
  - The org must not be suspended.
  - Return 409 if already a member.
  - Create the membership and set the invite to `accepted`.

### 3.3 Members

| # | Route | Permission (scope) | Input | Output |
|---|---|---|---|---|
| 12 | `GET /app/orgs/{org_id}/members` | `member.manage` (org) | query: `q?, role?`, page | Page of MemberOut |
| 13 | `PATCH /app/orgs/{org_id}/members/{member_id}/role` | `org.role.assign` (org) | body: `role_name` (`admin` / `member`) | MemberOut |
| 14 | `DELETE /app/orgs/{org_id}/members/{member_id}` | `member.manage` (org) | none | 204 |
| 15 | `PATCH /app/orgs/{org_id}/members/{member_id}/status` | `member.manage` (org) | body: `status` (`active` / `suspended`) | MemberOut (optional) |

Rules:
- #13: can't target the owner (use transfer ownership), can't change your own role, an org must keep one owner.
- #14:
  - An admin can remove only `member` roles. Only an owner can remove an admin. Nobody can remove the owner.
  - Use `leave` to remove yourself.
  - If the target leads a team, clear `team.lead_member_id`.
- #15: a suspended membership is blocked by the org dependency.

### 3.4 Teams

| # | Route | Permission (scope) | Input | Output |
|---|---|---|---|---|
| 16 | `POST /app/orgs/{org_id}/teams` | `team.manage` (org) | body: `name, lead_member_id?` | 201 TeamOut |
| 17 | `GET /app/orgs/{org_id}/my-teams` | `org.view` (org) | none | list of `{team: TeamOut, my_team_role}` |
| 18 | `GET /app/orgs/{org_id}/teams/{team_id}` | `team.view` (team) or `team.manage` (org) | none | TeamOut + `members[TeamMemberOut]` |
| 19 | `PATCH /app/orgs/{org_id}/teams/{team_id}` | `team.manage` (org) | body: `name` | TeamOut |
| 20 | `DELETE /app/orgs/{org_id}/teams/{team_id}` | `team.manage` (org) | none | 204 |
| 21 | `GET /app/orgs/{org_id}/teams/{team_id}/members` | `team.view` (team) or `team.manage` (org) | none | list of TeamMemberOut |
| 22 | `POST /app/orgs/{org_id}/teams/{team_id}/members` | `team.manage` (org) | body: `member_id` | 201 TeamMemberOut |
| 23 | `DELETE /app/orgs/{org_id}/teams/{team_id}/members/{member_id}` | `team.manage` (org) | none | 204 |
| 24 | `PUT /app/orgs/{org_id}/teams/{team_id}/lead` | `team.lead.assign` (org) | body: `member_id` | TeamOut |

Rules:
- Admins are not team members, so #18 and #21 must accept either `team.view` on the team or `team.manage` on the org. Write one dependency for "team viewer or org manager".
- #16: if `lead_member_id` is given, it must be an active member of the org. Create their `team_members` row with the `team_lead` role. Optional: unique (`org_id`, `name`).
- #20: return 409 if the team has `submitted` plans. Otherwise delete. Your FK sets `plans.team_id` to null.
- #22: the member must be active in the same org. New rows get the `team_member` role. Return 409 if already in the team.
- #23: if the removed member is the lead, clear `team.lead_member_id`. Return 409 if they have a `submitted` plan in this team. Otherwise set `team_id = null` on their draft plans for this team.
- #24: the new lead must already be in the team, otherwise 409. In one transaction: old lead's `team_members.role` becomes `team_member`, new one becomes `team_lead`, and `team.lead_member_id` is updated. `Team.lead_member_id` and the `team_lead` row must never disagree. Put this in one service function.
- Existing `GET /app/orgs/{org_id}/teams` needs `team.manage`, so only admins and owners can use it. Keep it for them. Members use #17.

### 3.5 Plans (author side)

All use `plan.manage_own` (org) and author-only access.

| # | Route | Input | Output |
|---|---|---|---|
| 25 | `GET /app/orgs/{org_id}/plans` | query: `week_start_date?, status?`, page | Page of PlanSummary (own plans) |
| 26 | `POST /app/orgs/{org_id}/plans` | body: `team_id, week_start_date, tasks[TaskIn]` | 201 PlanOut |
| 27 | `GET /app/orgs/{org_id}/plans/{plan_id}` | none | PlanOut |
| 28 | `PUT /app/orgs/{org_id}/plans/{plan_id}` | body: `team_id?, tasks[TaskIn]` | PlanOut |
| 29 | `DELETE /app/orgs/{org_id}/plans/{plan_id}` | none | 204 |
| 30 | `PATCH /app/orgs/{org_id}/plans/{plan_id}/tasks/{task_id}` | body: `status` (`pending` / `done`) | TaskOut |
| 31 | `POST /app/orgs/{org_id}/plans/{plan_id}/submit` | none | PlanOut |
| 32 | `POST /app/orgs/{org_id}/plans/{plan_id}/complete` | body: `main_shipped` (bool) | PlanOut |
| 33 | `POST /app/orgs/{org_id}/plans/{plan_id}/withdraw` | none | PlanOut (optional) |

Rules:
- #26:
  - `week_start_date` must be a Monday (check `weekday() == 0`).
  - `team_id` must be a team in this org that the caller belongs to.
  - Unique (`member_id`, `org_id`, `week_start_date`). On a duplicate, return 409 with the existing plan id.
  - A draft may be incomplete, but has at most one `main` task.
- #28: replaces the task list. Tasks with an `id` are updated, new ones are created, missing ones are deleted. Only in `draft`, otherwise 409. The week can't change.
- #29: only in `draft`.
- #30: allowed only when the plan is `approved`. Task text can't change after approval.
- #31 (`draft → submitted`): requires `team_id` set, the author still in that team, exactly one `main` task with a non-empty `why_it_matters`. Go-to-market goals are not required, because the AI flags them instead. Sets `submitted_at`.
- #32 (`approved → done`): sets `main_shipped`, `completed_at`.
- #33 (`submitted → draft`): the author pulls the plan back before the lead acts.

### 3.6 Team lead side

All use the team scope. The plan must satisfy `plan.team_id == {team_id}` and `plan.org_id == {org_id}`, otherwise 404. Drafts are never visible here.

| # | Route | Permission (scope) | Input | Output |
|---|---|---|---|---|
| 34 | `GET /app/orgs/{org_id}/teams/{team_id}/plans` | `plan.view_team` (team) | query: `week_start_date?, status?, member_id?`, page | Page of PlanSummary + `author {member_id, first_name, last_name}` |
| 35 | `GET /app/orgs/{org_id}/teams/{team_id}/plans/{plan_id}` | `plan.view_team` (team) | none | PlanOut + `author` |
| 36 | `POST .../plans/{plan_id}/approve` | `plan.approve` (team) | none | PlanOut |
| 37 | `POST .../plans/{plan_id}/return` | `plan.return` (team) | body: `comment` (1-2000 chars) | PlanOut |
| 38 | `GET /app/orgs/{org_id}/teams/{team_id}/week` | `team.week.view` (team) | query: `week_start_date` (Monday) | see below |
| 39 | `GET /app/orgs/{org_id}/teams/{team_id}/history` | `team.history.view` (team) | query: `from?, to?`, page | Page of week summaries |

Rules:
- #36: `submitted → approved`. Sets `approved_by_member_id` and `approved_at`. If the caller's membership equals the author, return 403.
- #37: `submitted → draft`. Sets `lead_comment` and `returned_at`. Same self-check.
- #38 output:
  - `week_start_date`
  - `members[]`: `member_id, first_name, last_name, plan_id or null, status or "no_plan", tasks_total, tasks_done, main_shipped`
  - `totals`: `members, no_plan, submitted, approved, done`
  - It lists every team member, including those with no plan.
- #39 output per week: `week_start_date, members, submitted, approved, done, shipped, tasks_total, tasks_done`. Newest first, current week and earlier only.

### 3.7 AI

Both use `plan.ai_use` (org). Both log one `ai_calls` row, including on failure.

| # | Route | Input | Output |
|---|---|---|---|
| 40 | `POST /app/orgs/{org_id}/plans/{plan_id}/review` | none (server builds the prompt from the database) | `PlanReview {verdict, summary, findings[]}` + `plan_updated_at` |
| 41 | `POST /app/orgs/{org_id}/plans/draft` | body: `notes` (1-4000 chars), `week_start_date?` | `PlanDraft {main_task, sub_goals[], go_to_market[], unclear[]}` |

Rules:
- #40:
  - Author only, plan in `draft`.
  - `task_ref` is a task UUID or `"plan"`.
  - The UI must save the draft (`PUT`) before calling review, because the server reads from the database. The UI compares `plan_updated_at` to mark old reviews outdated.
- #41: saves nothing. Each draft task maps one-to-one to a `TaskIn` (use `task_type = 'sub'`).
- Failures:
  - `429` with `{code: "rate_limited", message}` for your own limit or Google's 429.
  - `503` with `{code: "unavailable" / "timeout" / "invalid_output", message}` otherwise.
  - Both messages are plain text and say the plan is safe.
- Don't raise inside the service. Return a result object so the log row still commits.

## 4. Fixes for routes you already have (`/app`)

- **`POST /app/auth`** duplicates `/app/login`. Remove it if it's a Launchbase leftover.
- **`POST /app/login` is shared by customers and staff.** Make sure the JWT carries a `surface` claim (`app` or `internal`), so a staff token is rejected on `/app` and a customer token is rejected on `/internal`.
- **`POST /app/create-account`:** the schema must forbid `is_admin` and any extra fields. Return 409 for a duplicate email. It should not create an org. The client calls `POST /app/orgs` next.
- **`GET /app/orgs/{org_id}/teams`:** keep it for `team.manage`, and add #17 for everyone else.
- **Every request** must re-check `user.is_active` and `org.is_suspended`, not only at login.

## 5. Internal routes (`/internal`)

### 5.1 Already there, but needs changes

| Route | Change |
|---|---|
| `GET /internal/orgs` | Output per org: `id, name, is_suspended, member_count, team_count, plan_count, last_active_at, created_at`. Query: `q?, is_suspended?`, page. Needs `organizations.last_active_at` |
| `POST /internal/orgs/{id}/suspend` and `/reinstate` | Optional body `{reason}`. Return 409 if already in that state. Write an audit log row |
| `GET /internal/users` | Query: `q?, is_active?`, page. Output: `id, email, first_name, last_name, is_active, org_count, created_at` |
| `GET /internal/users/{id}` | Add `memberships[{org_id, org_name, role, status}]`. No plan content |
| `POST /internal/users/{id}/deactivate` | Can't deactivate yourself. Can't deactivate a staff user unless you have `platform.staff.manage`. Write an audit log row |
| `GET /internal/ai-usage` | Query: `from?, to?, org_id?`. Per org: `org_id, org_name, total_calls, success, failed, rate_limited, timeout, invalid_output, last_call_at`, plus `totals`. Counts only, no text. Needs the `ai_calls` table |
| Staff routes | See 5.3 |

### 5.2 Problem routes (no permission today)

These are marked "Staff Authenticated", so a `viewer` could call them:
- `POST /internal/users`
- `PATCH /internal/users/{user_id}`
- `POST /internal/users/{user_id}/change-password`
- `DELETE /internal/users/{user_id}`

My advice:
- **Remove `POST /internal/users`.** Customers sign up themselves, and staff are created at `/internal/staff`.
- **Remove `DELETE /internal/users/{user_id}`.** A hard delete cascades memberships and plans. Deactivate is enough.
- **Remove `change-password`.** Staff resetting a customer's password is a security risk, and the brief has no password reset.
- If you keep `PATCH`, restrict it to name fields and put it behind `platform.user.deactivate`.

### 5.3 Missing or to confirm

| # | Route | Permission (scope) | Input | Output |
|---|---|---|---|---|
| I1 | `GET /internal/orgs/{id}` | `platform.org.view` | none | org row + owners (name, email), `plans_by_status` counts, `ai_calls_30d`. No plan text |
| I2 | `POST /internal/users/{id}/reactivate` | `platform.user.deactivate` | none | user |
| I3 | `GET /internal/audit-logs` | `platform.audit.view` | query: `staff_user_id?, action?, target_type?, from?, to?`, page | Page of `{id, staff_user_id, staff_email, action, target_type, target_id, created_at}` |
| I4 | `GET /internal/ai-usage/{org_id}` | `platform.ai_usage.view` | query: `from?, to?` | daily counts by status (optional, for charts) |
| I5 | `GET /internal/staff` | `platform.staff.manage` | page | Page of `{user_id, email, name, role, is_active, created_at}` |
| I6 | `POST /internal/staff` | `platform.staff.manage` | body: `email, password, first_name, last_name, role_name` | 201 staff row |
| I7 | `PATCH /internal/staff/{id}` | `platform.staff.manage` | body: `first_name?, last_name?, role_name?` | staff row |
| I8 | `DELETE /internal/staff/{id}` | `platform.staff.manage` | none | 204 |

Rules:
- `role_name` is one of `super_admin`, `operations`, `support`, `viewer` (`scope='platform'`).
- Your `platform_members` unique key is (`user_id`, `role_id`), which allows several roles per user. The service must keep exactly one.
- #I6: sets `is_admin = true` and creates the `platform_members` row. Email must be new, or belong to a non-staff user you decide to promote (return 409 otherwise).
- #I8: remove the `platform_members` row and set `is_admin = false`. Don't delete the user.
- Can't change or remove yourself. Keep at least one active `super_admin`.
- `POST /internal/auth`: require `is_admin`, at least one platform role, an active user, and issue a token with `surface = internal`.
- Every suspend, reinstate, deactivate, reactivate and staff change writes a `staff_audit_logs` row in the same transaction.
- No `/internal` route returns plan titles, descriptions or AI output.

## 6. Decisions you must make (write them in SUBMISSION.md)

1. **A lead's own plan has no reviewer.** Your rule says a lead can't approve their own plan, and each team has one lead, so it would stay `submitted` forever. Options:
   - (a) auto-approve a lead's plan when they submit (`approved_by` = themselves). This is my pick.
   - (b) allow self-approval.
   - (c) let an org owner approve. This needs a new permission.
   Update the AGENTS.md rule and tests to match.
2. **Removing a member deletes their plans.** `Membership.plans` cascades, so leaving or being removed erases history that leads see. Either accept that and document it, or add a `removed` status and keep the row. Hard delete is simpler.
3. **Ticking tasks** is allowed only in `approved`. If you want it in `submitted` too, change #30.
4. **Review reads from the database**, so the UI saves the draft first.
5. **Staff roles:** four staff roles are extra to the brief. Note that in `SUBMISSION.md`.

## 7. Tests per route

- Wrong role: 403.
- Admin in org A on org B where they are a member: 403.
- ID from another org: 404.
- Wrong state, such as editing a submitted plan: 409.
- Suspended org and deactivated user: blocked.
- Customer token on `/internal` and staff token on `/app`: rejected.

## 8. Suggested build order

1. Model changes and migration.
2. Orgs, invites, members.
3. Teams and lead assignment.
4. Plans (author side), then lead approval, week and history.
5. `ai_calls`, then AI routes and the internal usage view.
6. Internal clean-up, audit logs and staff routes.