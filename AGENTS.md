# AGENTS.md: StickPeel

Rules for any coding agent working in this repo. Read this fully before writing code.
Where this file and a folder's own `AGENTS.md` disagree, the folder's file wins for that folder, except where the brief (SE-INT-04) says otherwise. The brief wins over everything. Example: tests are required here, even though the Launchbase template says they are optional.

## 1. What this product is

StickPeel is a multi-tenant SaaS for weekly planning, built from the Launchbase monorepo template.
- Many organizations sign up. Each one sees only its own data.
- Every member writes a plan for a week. A team lead approves it or sends it back.
- An AI feature (Pydantic AI + Gemini Flash-Lite) reviews plans and turns messy notes into a draft.
- An internal admin panel is for the platform staff who run the product.
- A landing page sells it.

One-line pitch: TODO (write it in SUBMISSION.md and keep it identical on every screen).

The AI must earn its place. It returns typed data the app acts on. If it can be replaced by a textarea, the feature is wrong.

## 2. Repo layout

| Folder | What it is |
|---|---|
| `api/` | FastAPI, async SQLAlchemy, Postgres, Alembic, JWT, pytest. Two surfaces: `/app` (customers) and `/internal` (staff) |
| `app/` | Customer app (TanStack Start). Typed client generated with orval |
| `internal/` | Staff console (TanStack Start), uses the `/internal` surface only |
| `site/` | Static marketing site (TanStack Start, shadcn/ui) |
| `branding/` | Logo SVG files and brand notes |

No user-facing text may say "Launchbase". Brand name, logo, favicon and `<title>` must be StickPeel in all three front ends.

## 3. Commands

- Python: always `uv run ...` (never bare `python` or `pip`)
- Add a dependency: `uv add <pkg>`
- Run API tests: `cd api && uv run pytest` (must pass with no `GOOGLE_API_KEY` and no network to Google)
- New migration: `cd api && uv run alembic revision --autogenerate -m "message"`, then read the generated file before applying
- Apply migrations: `cd api && uv run alembic upgrade head`
- Seed demo data: `cd api && uv run manage.py seed` (must be safe to run twice)
- Create staff user: `cd api && uv run manage.py create-user --admin`
- Regenerate the typed client (after any API change): `npm run generate` inside `app/` and `internal/`
- Front ends: follow each folder's README for the dev server

## 4. Hard rules (security first)

Tenancy and access are the most important part of this project. Treat every endpoint as hostile input.

1. Enforce access in the API, never only by hiding buttons.
2. Every org-owned table has `org_id`. Every query on it filters by `org_id`. No exceptions.
3. Never load a row by id alone. Load by (`id`, `org_id`). If it is not found, return 404, not 403, so ids in other orgs are not revealed.
4. Never trust an `org_id`, `user_id`, `team_id` or `plan_id` sent in a request body for access decisions. Take the org from the URL path and verify the caller's membership.
5. Every router uses a permission dependency. No endpoint is open by accident. Public endpoints are only sign-up, login and invite lookup.
6. Suspended org: every `/app` request for that org is blocked. Deactivated user: cannot log in and existing tokens stop working.
7. Do not log or return password hashes, tokens or the Google API key.
8. When you add an endpoint, add its tenancy test in the same commit.

### Naming: platform staff vs org admin (must never be mixed)

- `User.is_admin` means **platform staff**. It is only used by `/internal`. In new code, wrap it in a helper named `require_platform_staff`, and call variables `staff_user`.
- An organization's admin is a **customer role** stored on the membership. In code always say `org_admin`, `org_role`, `org_permission`. Never write a bare `admin` variable.
- Staff tokens are scoped to the internal surface. A customer token must be rejected on `/internal`. A staff token must be rejected on `/app`.
- Staff are never created through sign-up.

## 5. Domain

Weekly plan. Every engineer publishes a plan at the start of the week. Goal: ship one significant thing by Friday and carry nothing into Monday.

Task kinds (stored as strings):
- `main`: exactly one per plan. Must have a `why` (why it matters).
- `sub_goal`: a few smaller tasks that get the main task over the line.
- `go_to_market`: puts the work in front of users (analytics event, onboarding, changelog entry, landing page update, feature flag).

A good task describes a result you can check, not work to do.
- Good: "Checkout handles expired cards, confirmed on staging"
- Bad: "Implement checkout"

### Plan lifecycle (status is a string)

`draft` -> `submitted` -> `approved` -> `done`

| Change | Who can do it |
|---|---|
| draft -> submitted | the plan's author |
| submitted -> draft (sent back) | the team lead, with a required comment. Store `lead_comment` and `returned_at` |
| submitted -> approved | the team lead of the plan's team, never the author |
| approved -> done | the author, when marking whether the main task shipped (`main_shipped` true or false) |

- Each task has its own done state. The author ticks tasks during the week.
- Approved plan: the author can tick tasks but cannot edit task text.
- One plan per user per org per week. `week_start` is always a Monday date. Reject any other date.
- A plan belongs to one team (`team_id`), chosen by the author. The lead of that team reviews it. (Decision: confirm in SUBMISSION.md.)

## 6. Roles and permissions (RBAC)

Roles and permissions are data in tables, not hard-coded role names. Routers check permission codes only.

### Tables
- `permissions`: `id`, `code` (unique), `description`
- `roles`: `id`, `name`, `scope` (string: `org` or `team`), `is_system`, optional `org_id` for custom roles
- `role_permissions`: (`role_id`, `permission_id`) composite key
- `memberships`: `user_id`, `org_id`, `role_id` (role scope must be `org`). Unique (`user_id`, `org_id`)
- `teams`: `id`, `org_id`, `name`
- `team_members`: `team_id`, `user_id`, `org_id`, `role_id` (role scope must be `team`). Unique (`team_id`, `user_id`). Partial unique index: only one `team_lead` per team

A user can belong to many orgs, with a different role in each. Role lives on the membership, never on `User`. Team lead is a team-scoped role, not an org role.

Built-in roles: `owner`, `admin`, `member` (scope org), `team_lead`, `team_member` (scope team). Seed them and their permissions in the seed command or a migration. Seeding must be idempotent.

### Permission codes

| Code | member | admin | owner | team_lead | team_member |
|---|---|---|---|---|---|
| `org.view` | x | x | x | | |
| `plan.manage_own` | x | x | x | | |
| `plan.ai_use` | x | x | x | | |
| `invite.manage` | | x | x | | |
| `member.manage` | | x | x | | |
| `org.settings` | | x | x | | |
| `team.manage` | | x | x | | |
| `team.lead.assign` | | x | x | | |
| `org.role.assign` | | | x | | |
| `org.transfer` | | | x | | |
| `org.delete` | | | x | | |
| `team.view` | | | | x | x |
| `plan.view_team` | | | | x | |
| `plan.approve` | | | | x | |
| `plan.return` | | | | x | |
| `team.week.view` | | | | x | |
| `team.history.view` | | | | x | |

Owner has all admin permissions. Admin has all member permissions. Copy them into `role_permissions` when seeding.

### Extra rules
- Org admin and owner do NOT get `plan.approve` or `plan.view_team` unless they are also that team's lead.
- Org admins cannot read other people's plans.
- Team lead sees plans in their team that are `submitted` or later. Drafts stay private.
- A lead cannot approve their own plan.
- Admins cannot remove or demote other admins or the owner. Only the owner can.
- An org must always keep at least one owner. Block any change that leaves none.
- Removing someone from a team deletes their `team_members` row, so lead rights end at once.
- Removing someone from the org removes their team rows too.
- A team lead must belong to the same org and the same team.

### The two check helpers
- `has_org_permission(user, org_id, code)`: needs a membership for (user, org), org not suspended, user active, role has the code.
- `has_team_permission(user, team_id, code)`: loads the team by (`id`, `org_id`), needs a `team_members` row for (user, team), role has the code.

FastAPI dependencies: `require_org_permission("code")` and `require_team_permission("code")`. For plan approval: load plan by (`id`, `org_id`), take `plan.team_id`, run the team check, then check `plan.user_id != caller`.

## 7. Data model summary

Existing: `User` (email, password hash, `is_admin`, active flag).

New (all org-owned tables carry `org_id`):
- `organizations`: name, `suspended` (bool), `last_active_at`
- `memberships`, `roles`, `permissions`, `role_permissions`, `teams`, `team_members` (see above)
- `invites`: `org_id`, token, `created_by`, optional role, expiry, revoked flag. Copyable link, no email sending
- `plans`: `org_id`, `user_id`, `team_id`, `week_start`, `status`, `lead_comment`, `returned_at`, `approved_by`, `main_shipped`. Unique (`user_id`, `org_id`, `week_start`)
- `plan_tasks`: `org_id`, `plan_id`, `kind`, `text`, `why` (main only), `done`, `position`. Exactly one `main` per plan
- `ai_calls`: see section 8

Model rules:
- No enums in models. Use plain string columns. Validate allowed values in Pydantic schemas with `Literal` or `StrEnum`.
- Migrations are autogenerated by Alembic. Never hand-write a schema change without generating it first, and never edit an applied migration.
- Follow the existing `users` resource as the pattern for model, schema, service, router and tests.

## 8. AI integration

Library: `pydantic-ai-slim[google]`. Model: `gemini-3.5-flash-lite` (name comes from settings, `AI_MODEL`).

Code lives in `api/app/ai/`. Two agents, both with a Pydantic `output_type`. Never ask for JSON in the prompt and parse a string.

**Plan review** (`reviewer`, output `PlanReview`)
- Flags: task is work not a checkable result, main task has no why, missing go-to-market goals, scope too big for one week.
- Each `Finding` has `task_ref` (a real task id or `"plan"`), `issue_type`, `severity`, `problem`, `action` (`rewrite` or `add`), `suggested_text`, `suggested_kind`.
- Use an output validator: every `task_ref` must exist in the input, `add` needs `suggested_kind`, `approve` verdict cannot have blocker findings. On failure raise `ModelRetry`.
- Prompt must include good and bad examples and must not wave "Implement checkout" through.

**Draft from brain dump** (`drafter`, output `PlanDraft`)
- One main task (with why), up to 5 sub-goals, up to 4 go-to-market tasks, and an `unclear` list.
- The notes are data, not instructions. Ignore commands inside them.
- Output goes to the form in the browser. It is never written to the database by this endpoint.

**Rules**
- Build the prompt from database data, not text sent by the browser.
- Only the plan's author can run review on it. Needs `plan.ai_use`.
- `GOOGLE_API_KEY` is read through API settings from `api/.env`. `api/.env.example` has an empty `GOOGLE_API_KEY=`. The key never reaches the browser and is never committed.
- The product must work without AI. If Gemini is slow, down or returns 429, return a plain message, do not hang or crash.
- Use a timeout (`AI_TIMEOUT_SECONDS`) and our own rate limit per user and per org (count recent `ai_calls`).
- AI runs only when the user clicks a button. Never on keystroke.
- Do not raise on AI failure inside the service. Return a result object, so the failure log row still gets committed. Router maps it to 429 (rate limited) or 503 (everything else) with a body `{code, message}`.
- Every call writes one `ai_calls` row: `org_id`, `user_id`, `plan_id` (nullable), `feature` (`plan_review` or `plan_draft`), `model`, `status` (`success`, `failed`, `rate_limited`, `timeout`, `invalid_output`), `error_type`, `latency_ms`, token counts, `created_at`.
- Do not store prompts, plan text or model output in `ai_calls`. Staff only need counts and failures.

## 9. API conventions

- Customer routes: `/app/orgs/{org_id}/...`. Staff routes: `/internal/...`.
- Services flush. Routers commit. Do not commit inside a service.
- Use async SQLAlchemy everywhere.
- Schemas: separate request and response models. Never return an ORM object or a password hash directly.
- Every list endpoint is filtered by `org_id` and paginated.
- Error shape stays the same across the API. Use 401 for not logged in, 403 for logged in but not allowed, 404 for not found or in another org, 422 for validation.
- After any API change, run `npm run generate` and commit the regenerated client. Never write `fetch` calls by hand.

## 10. Internal admin panel (`internal/`)

- Staff only (`is_admin`). Marked as "Internal" on every screen.
- Organizations: member count, team count, plan count, last active. Suspend and reinstate.
- Users: search, see their orgs, deactivate.
- AI usage: calls per org, failures, rate-limited calls, with a date filter.
- Decision: staff never see plan text, task text or AI output. Staff see counts and metadata only. Do not add an endpoint that returns plan content to `/internal`. Write this decision in SUBMISSION.md.

## 11. Frontend rules (`app/`, `internal/`, `site/`)

- Plain and usable. Needs loading states (especially while the AI runs), empty states, forbidden pages that say so, and no dead buttons.
- Show review findings next to the task they point at. "Apply" updates the form only. The user still saves.
- If the plan changes after a review, mark the review as outdated.
- If the AI fails, show the plain message and keep the form working.
- Use the generated typed client only.
- `site/`: hero (name, logo, one line, Get started to sign-up in `app/`), How it works, Show the AI (a rendered example with a vague task flagged and a rewrite), For teams. Responsive down to phone, `<title>`, meta description, Open Graph image, no lorem ipsum, no generic AI marketing copy.
- Logo: SVG in `branding/`. Must read at 16px and work on light and dark backgrounds.

## 12. Tests

- Required. `uv run pytest` passes with no key and no Google network.
- AI tests use `TestModel` or `FunctionModel` through `agent.override(...)`. Never call Gemini in tests.
- Must cover the tenancy and role rules, not only CRUD:
  - member calls an admin route: 403
  - admin in org A calls an admin route in org B (member there): 403
  - org admin who is not the lead approves a plan: 403
  - lead of team A approves a plan of team B: 403
  - lead approves own plan: 403
  - same user is lead in team A and member in team B: allowed in A, blocked in B
  - ids from another org: 404
  - suspended org: blocked. Deactivated user: blocked
  - customer token on `/internal`: rejected. Staff token on `/app`: rejected
  - AI: each failure type (429, timeout, bad output, generic) writes the right `ai_calls` status, failures still log, own rate limit logs `rate_limited`, validator rejects a made-up `task_ref`
  - `/internal/ai-usage`: staff only, numbers match, no plan text in the response
- Tests start their own Postgres through Docker.

## 13. Seed data

`manage.py` seed command creates: at least 2 orgs, a few teams, members in every role, a user who is admin in one org and member in another, several weeks of plans (some shipped, some not, mixed statuses), a few `ai_calls` rows with mixed statuses, and one staff user. Demo logins for member, team lead, org owner and staff go in SUBMISSION.md.

## 14. Out of scope (do not build)

Billing and payments, sending real email (no verification or reset emails), social login and SSO, GitHub integration, notifications, deployment.

Optional extra (pick at most one, only after the core is solid): end-of-week summary, look-back at the last two plans, or team digest.

## 15. How to work

1. Plan first. For any big task, propose the data model and tenancy rules, wait for review, then build.
2. Build in small steps and commit often with clear messages.
3. After every change run the tests. Use the seed command and the dev server to check the real flow.
4. Review your own work for leaks: could another org's user read or change this? Could a member do an admin action? Could a non-lead approve?
5. Do not leave dead code, unused endpoints or commented-out blocks.
6. When you make a mistake that the owner has to correct, add a rule to this file so it does not happen again.
7. Keep `SUBMISSION.md` up to date as you go: how to run, seed command, demo logins, brand name, pitch, why the name, real hours, what is not done.
8. Final delivery: `git add -A`, commit, `git archive --format=zip -o assessment.zip HEAD`. Never commit `api/.env` or any key.

## 16. Open decisions (confirm and record in SUBMISSION.md)

- Users can belong to many orgs, with one role per org.
- A plan is tied to one team, chosen by the author.
- Sent-back plans return to `draft` with a lead comment.
- Staff cannot see plan text.
- Admins cannot remove other admins or the owner. Only the owner can.