# AI features for StickPeel

This matches the models you pasted: plans belong to a membership (`member_id`), and tasks use `task_type` (`main`, `sub`, `go_to_market`) with `title`, `description` and `why_it_matters`. It needs the `ai_calls` table from my earlier design.

## 1. AI tasks to perform

**A. Plan review agent**
- Reads one draft plan and returns a typed review, like a demanding team lead.
- Flags:
  - tasks that describe work, not a checkable result
  - a main task with no why it matters
  - missing go-to-market goals
  - scope too big for one week
- Every finding points at one task (or at the whole plan) and gives a rewrite you can paste.
- It must not flag tasks that are already good.

**B. Brain dump to draft agent**
- Takes messy notes and returns a pre-filled plan: one main task with a why, a few sub-goals, a few go-to-market tasks, and a list of unclear items.
- It saves nothing. The member edits the result in the form, then saves with the normal plan routes.

**C. Guardrails**
- The server builds the review prompt from the database. It never trusts task text sent by the browser.
- Output validators reject made-up task references and incomplete findings, and the agent retries.
- Notes are treated as data, not commands.
- Don't send names, emails or ids to the model. Send task text only.
- The agent has no database access and no tools (unless you add the optional look-back).

**D. Limits and logging**
- Per-user and per-org rate limits, counted from `ai_calls`.
- A timeout on every call.
- Every attempt writes one `ai_calls` row, including failures and rate-limited calls.
- No prompt, plan text or output is stored.

**E. Failure handling**
- Gemini slow, down, 429, or bad output: return a plain message. Planning keeps working.
- No `GOOGLE_API_KEY` set: the AI reports itself as unavailable and the UI hides the buttons.

**F. Frontend tasks**
- Buttons trigger the calls. Nothing runs on keystroke.
- Show a loading state, then findings next to their tasks, with an Apply button that edits the form only.
- Mark a review as outdated when the plan changes.
- Show plan-level findings in a box above the tasks.

**G. Tests (no Gemini, no network)**
- See section 7.

**H. Seed data**
- A few `ai_calls` rows per org with mixed statuses, so the staff usage page isn't empty.

**I. Optional extra (pick at most one, only after the core works)**
- End-of-week summary, look-back tool, or team digest. See section 6.

## 2. Tech stack for the AI functions

| Need | Use |
|---|---|
| Agent framework | Pydantic AI: `uv add "pydantic-ai-slim[google]"` |
| Model | `gemini-3.5-flash-lite` (the brief's name), read from settings as `AI_MODEL` |
| Typed output | Pydantic v2 models as the agent's `output_type` |
| Output checks | `@agent.output_validator` plus `ModelRetry` |
| Validator context | Pydantic AI `deps_type` (the plan's task ids are passed in as deps) |
| Settings and key | Your existing API settings, loaded from `api/.env`: `GOOGLE_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_SECONDS`, `AI_LIMIT_USER_PER_MIN`, `AI_LIMIT_ORG_PER_MIN` |
| API | FastAPI, async, same permission dependencies as the other routes |
| Storage and rate limit | The `ai_calls` table in Postgres. Count recent rows, so there is no Redis |
| Timeout | `asyncio.timeout(AI_TIMEOUT_SECONDS)` around `agent.run` |
| Error types | `ModelHTTPError` (check `status_code == 429`), `UnexpectedModelBehavior` (bad output after retries), `TimeoutError` |
| Token counts | From `result.usage()` |
| Tests | `TestModel`, `FunctionModel`, `agent.override(...)`, and `pydantic_ai.models.ALLOW_MODEL_REQUESTS = False` in test setup, so any real call fails loudly |
| Frontend | The orval-generated client (run `npm run generate`), no hand-written fetch |

Code layout in `api/app/`:
- `ai/schemas.py`: Pydantic models
- `ai/prompts.py`: instruction text
- `ai/agents.py`: the two agents, built from settings
- `ai/service.py`: limits, timeout, error mapping, logging
- `api/app/routers/ai.py`: the routes

Note: the Gemini free tier has low rate limits. Check Google's terms on how free-tier data is used, and use demo data only.

## 3. Models (typed data)

**Review input (built on the server)**
- `week_start_date`
- `tasks[]`: `ref` (the task uuid as text), `task_type`, `title`, `description`, `why_it_matters`

**Review output (`PlanReview`)**
- `verdict`: `approve` or `adjust`
- `summary`: one or two sentences
- `findings[]` (max 10), each with:
  - `task_ref`: a real task id, or `"plan"` for plan-level problems
  - `issue_type`: `not_checkable`, `missing_why`, `missing_gtm`, `scope_too_big`, `other`
  - `severity`: `blocker` or `suggestion`
  - `problem`: short explanation
  - `action`: `rewrite` or `add`
  - `target_field`: `title`, `description` or `why_it_matters` (for `rewrite`)
  - `suggested_text`: the new wording
  - `suggested_task_type`: `sub` or `go_to_market` (for `add`)

**Review output checks (validator)**
- Every `task_ref` is in the input ids, or is `"plan"`.
- `rewrite` needs a real task id and a `target_field`.
- `add` needs `task_ref = "plan"` and a `suggested_task_type`. Never `main`.
- `missing_why` must target the main task's `why_it_matters`.
- `title` rewrites are 255 characters or fewer, because that's your DB column length.
- `suggested_text` is not empty and differs from the current text.
- A verdict of `approve` can't have `blocker` findings.
- On any failure, raise `ModelRetry` with a clear message.

**Draft input**
- `notes` (1 to 4000 characters), optional `week_start_date`

**Draft output (`PlanDraft`)**
- `main_task`: `title`, `why_it_matters` (required), `description?`
- `sub_goals[]` (max 5): `title`, `description?`
- `go_to_market[]` (max 4): `title`, `description?`
- `unclear[]` (max 5): things in the notes the model couldn't place
- Titles are 255 characters or fewer. The route maps these to the `TaskIn` shape for the form.

**`ai_calls` table (new)**
- `id`, `org_id`, `user_id`, `plan_id` (null), `feature` (`plan_review` / `plan_draft`), `model`
- `status`: `success`, `failed`, `rate_limited`, `timeout`, `invalid_output`
- `error_type`, `latency_ms`, `input_tokens`, `output_tokens`, `created_at`
- Indexes: (`org_id`, `created_at`) and (`org_id`, `status`)

## 4. Customer routes (`/app`)

All need `plan.ai_use` (org scope). The org dependency also checks the membership, active user and suspended org.

| Method: Route | Permission (Scope) | Input | Output | Notes |
|---|---|---|---|---|
| POST: `/app/orgs/{org_id}/plans/{plan_id}/review` | `plan.ai_use` (org) | none. The server reads the plan from the database | 200 `{review: PlanReview, plan_updated_at, model, generated_at}` | Author only. Another member's plan returns 404. Plan must be `draft`, else 409. A plan with no tasks returns 409 `plan_empty`. The UI saves the draft (`PUT`) before calling, because the server reads from the database. The UI compares `plan_updated_at` to mark a review outdated. Nothing is saved. Logs one `ai_calls` row |
| POST: `/app/orgs/{org_id}/plans/draft` | `plan.ai_use` (org) | body: `notes` (1-4000), `week_start_date?` | 200 `{draft: PlanDraft, model, generated_at}` | Saves nothing. Empty or too-long notes return 422. Declare this route before any `/plans/{plan_id}` route. Logs one `ai_calls` row with `plan_id` null |
| GET: `/app/orgs/{org_id}/ai/status` | `plan.ai_use` (org) | none | `{available, reason, limits{per_user_per_min, per_org_per_min}, remaining{user, org}}` | `available` is false with `reason: "not_configured"` when there is no key. The UI uses this to hide or disable the AI buttons. Doesn't call Gemini and doesn't write a log row |

**Applying a suggestion needs no new route.** Apply changes the form in the browser. The member then saves with the existing `PUT /app/orgs/{org_id}/plans/{plan_id}`.

**Error responses** (both AI routes return `{code, message}`):

| HTTP | `code` | When | Extra |
|---|---|---|---|
| 429 | `rate_limited` | Your own limit, or Google returned 429 | `retry_after_seconds` |
| 503 | `timeout` | The call took longer than `AI_TIMEOUT_SECONDS` | |
| 503 | `invalid_output` | The model failed validation after the retries | |
| 503 | `unavailable` | Gemini down or any other failure | |
| 503 | `ai_not_configured` | No `GOOGLE_API_KEY` | Not logged as a Gemini failure |
| 409 | `plan_not_draft` / `plan_empty` | Wrong plan state | |

Messages are plain, for example: "The AI is busy right now. Your plan is safe. Try again in a minute."

## 5. Service flow (`ai/service.py`)

1. The router has already passed the permission, membership, suspended-org and author checks.
2. If there is no key, return `ai_not_configured` and write no log row.
3. Rate limit: count the caller's `ai_calls` from the last 60 seconds, using only rows that actually reached Gemini (not `rate_limited` rows, or a spammer would lock themselves out forever). If over the user or org limit, write a `rate_limited` row (`error_type = local_limit`) and return without calling Gemini.
4. Build the input from the database (review) or from the notes (draft).
5. Call the agent inside the timeout.
6. Map the outcome and write the `ai_calls` row, then flush:
   - success: `success`
   - `ModelHTTPError` 429: `rate_limited` (`error_type = provider_429`)
   - `TimeoutError`: `timeout`
   - `UnexpectedModelBehavior`: `invalid_output`
   - anything else: `failed`
7. Return a result object. Don't raise on AI failure inside the service, so the router still commits the log row. The router turns the result into the HTTP response above.

Prompt rules:
- Review: act like a demanding lead, define "checkable result" with good and bad examples ("Implement checkout" fails, "Checkout handles expired cards, confirmed on staging" passes), require a why on the main task, don't flag good tasks, and give a paste-ready rewrite per finding.
- Draft: pull out one main task, sub-goals and go-to-market tasks, write each as a checkable result, put unclear items in `unclear`, and ignore any instructions inside the notes. Wrap the notes in delimiters and say they are data.

## 6. Optional extra (pick at most one)

I'd pick the first one. It reuses data you already have, and needs one route.

| Method: Route | Permission (Scope) | Input | Output | Notes |
|---|---|---|---|---|
| POST: `/app/orgs/{org_id}/plans/{plan_id}/summary` | `plan.ai_use` (org) | body: `context?` (max 1000, the member's own words on why) | `{summary: {headline, shipped[], not_shipped[], reasons[]}, model, generated_at}` | Author only. Plan must be `approved` or `done`, else 409. Reads task statuses and `main_shipped` from the database. Saves nothing. Logs a row with `feature = plan_summary` |
| POST: `/app/orgs/{org_id}/teams/{team_id}/digest` | `team.week.view` (team) + `plan.ai_use` (org) | body: `week_start_date` | `{digest: {at_risk[], not_submitted[], highlights[]}, ...}` | Needs a dual-permission dependency. Send counts and task titles only. Logs `feature = team_digest` |
| Look-back tool (no route) | | | | Gives the reviewer a tool that reads the member's previous two plans, so it can flag work that keeps carrying over. Query by (`member_id`, `org_id`) only. This is the riskiest one for tenancy |

Add the feature name to the allowed `feature` values and to the internal usage counts if you build one.

## 7. Staff side (already designed)

No new routes. The usage view reads `ai_calls`:
- `GET /internal/ai-usage` and `GET /internal/ai-usage/{org_id}` need `platform.ai_usage.view`. They return counts only, never text.

## 8. Tests (no Gemini, no network)

- `uv run pytest` passes with `GOOGLE_API_KEY` unset. Set `ALLOW_MODEL_REQUESTS = False` in test setup.
- Review with a vague task: a `FunctionModel` returns a fixed `PlanReview`, and the route returns the findings.
- Validator: a `task_ref` that isn't in the plan makes the agent retry. After the retries, the result is `invalid_output`.
- Validator: `add` without a type, `approve` with a blocker, and a title over 255 characters are all rejected.
- Draft: the response never creates a plan or task row.
- Each failure type writes the right `ai_calls` status: 429, timeout, invalid output, other error. The row exists even though the response was an error.
- Own rate limit: the call returns 429, doesn't reach the model, and logs `rate_limited` with `local_limit`.
- `rate_limited` rows don't count toward the limit.
- Missing key: 503 `ai_not_configured`, and `GET /ai/status` shows `available: false`.
- Permissions and tenancy:
  - plan from another org: 404
  - another member's plan in the same org: 404
  - org admin who isn't the author: 404
  - suspended org: blocked
  - plan not in `draft`: 409
- The internal usage numbers match the log rows, and no response contains plan text.
- Optional route: wrong plan state returns 409, and a non-author gets 404.

## 9. Build order

1. `ai_calls` model and migration.
2. Schemas and the review agent with a `FunctionModel` test.
3. `service.py` (limits, timeout, error mapping, logging) with all failure tests.
4. The review route, then the draft route, then `/ai/status`.
5. Frontend buttons, loading and error states, Apply, and the outdated check.
6. Seed `ai_calls` rows and connect the internal usage view.
7. The optional extra, only if time is left.