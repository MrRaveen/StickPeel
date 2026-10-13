# StickPeel — Assessment Submission

## 1. Product Overview & Pitch

- **Brand Name**: StickPeel
- **One-line Pitch**: *Ship one significant outcome every Friday. Carry nothing into Monday.*
- **Why the Name**: Weekly commitments are like sticky notes: you stick your clear, checkable outcomes to the board on Monday, get them over the line through the week, and cleanly peel them off by Friday so nothing spills over into the next week.

---

## 2. Architecture & Monorepo Layout

StickPeel is a multi-tenant SaaS for disciplined engineering weekly planning, built on an asynchronous, strictly-isolated architecture:

| Component | Directory | Port | Tech Stack & Description |
|---|---|---|---|
| **Marketing Landing Site** | `site/` | `http://localhost:3000` | TanStack Start, Tailwind CSS, shadcn/ui. Unified hub with quick links to all surfaces. |
| **Customer App** | `app/` | `http://localhost:3001` | TanStack Start SPA, TanStack Query, typed OpenAPI SDK (orval). Weekly planning, AI drafting/reviews, approvals. |
| **Internal Staff Console** | `internal/` | `http://localhost:3002` | TanStack Start SPA. Dedicated staff portal (`is_admin`) for tenant suspensions, user deactivations, AI usage metrics, and audit logs. |
| **FastAPI Backend** | `api/` | `http://localhost:8000` | FastAPI, Async SQLAlchemy, Postgres 15, Alembic migrations, JWT auth, Pydantic AI. |
| **Interactive API Docs** | `api/` | `http://localhost:8000/docs` | Swagger / OpenAPI UI for customer (`/app/...`) and staff (`/internal/...`) surfaces. |

---

## 3. Quickstart & Reviewer Setup

### Step 1: Start PostgreSQL (Docker)

```bash
docker run -d \
  --name postgres-dev \
  -e POSTGRES_USER=raveenjayasanka41 \
  -e POSTGRES_PASSWORD='123456789' \
  -e POSTGRES_DB=launchbase \
  -p 5432:5432 \
  postgres:15
```

### Step 2: Initialize & Seed the Backend (`:8000`)

```bash
cd api

# Install dependencies with uv
uv sync

# Configure environment variables
cp .env.example .env

# Run database migrations
uv run alembic upgrade head

# Seed idempotent test organizations, teams, roles, plans, AI calls, and demo users
uv run manage.py seed

# Start the FastAPI server (runs on port 8000)
uv run fastapi dev --reload-dir app
```

*(Optional: Run automated test suite without Google API key / network: `uv run pytest`)*

### Step 3: Start Frontend Applications

Open separate terminal tabs or use tmux:

#### A. Marketing Landing Site (`:3000`)
```bash
cd site
npm install
npm run dev -- --port 3000
```

#### B. Customer Web Application (`:3001`)
```bash
cd app
npm install
npm run dev -- --port 3001
```

#### C. Internal Staff Console (`:3002`)
```bash
cd internal
npm install
npm run dev -- --port 3002
```

---

## 4. Demo Login Credentials

The idempotent database seed command (`uv run manage.py seed`) prepares realistic multi-tenant accounts with pre-populated weekly plans, team assignments, and AI analytics:

### Customer App (`http://localhost:3001`)

| Role | Email | Password | Organization & Context |
|---|---|---|---|
| **Org Owner** | `owner@acme.com` | `DemoPass123!` | Owner of **Acme Corp**. Full tenant settings, member management, invite generation. |
| **Team Lead & Admin** | `lead@acme.com` | `DemoPass123!` | Org Admin & Lead of **Core Platform** in Acme Corp; also member in **Beta Labs**. Reviews & approves plans. |
| **Team Member / Engineer** | `dev@acme.com` | `DemoPass123!` | Engineer in **Core Platform** (Acme Corp). Has active submitted and past shipped plans. Uses AI review/drafting. |
| **Beta Labs Owner** | `owner@beta.com` | `DemoPass123!` | Owner of **Beta Labs** (demonstrates multi-tenant data isolation). |
| **Deactivated Account** | `inactive@acme.com` | `DemoPass123!` | Inactive account (login blocked with 403 Forbidden). |

### Internal Staff Console (`http://localhost:3002`)

*Note: Customer tokens are rejected on `/internal`. Staff tokens are rejected on `/app`.*

| Role | Email | Password | Access Scope |
|---|---|---|---|
| **Platform Super Admin** | `staff@stickpeel.internal` | `StaffPass123!` | Full internal access: suspend/reinstate tenants, deactivate users, inspect AI token analytics, audit logs. |
| **Platform Operations** | `ops@stickpeel.internal` | `StaffPass123!` | Operations role: view organizations, manage tenant status, view audit history. |

---

## 5. Architectural & Domain Decisions Recorded

Per the specification guidelines, the following open decisions are confirmed:

1. **Multi-Tenancy & Access Isolation**:
   - Every org-owned table has an `org_id`. All queries strictly filter by `(id, org_id)`.
   - Never load records by ID alone; querying resources belonging to another organization yields an immediate `404 Not Found` (never revealing ID existence).
   - Suspended organizations reject all `/app` customer traffic immediately. Deactivated users cannot log in and existing JWT tokens cease working immediately.

2. **Roles and Permissions (RBAC)**:
   - Dynamic table-based RBAC (`roles`, `permissions`, `role_permissions`, `memberships`, `team_members`). No hardcoded role strings in router logic.
   - Users can belong to multiple organizations with distinct roles in each (e.g., `lead@acme.com` is admin/lead in Acme Corp, but a regular member in Beta Labs).
   - Team lead is a team-scoped role (`team_members`), not an org role. Admins/owners cannot approve plans unless they are the assigned lead of that team.
   - A team lead cannot approve their own plan.

3. **Plan Domain & Lifecycle**:
   - Plan lifecycle: `draft` -> `submitted` -> `approved` -> `done`.
   - Sent-back plans transition back to `draft` with a required lead comment (`lead_comment`) and timestamp (`returned_at`).
   - Each plan is tied to a specific Monday date (`week_start_date`), and one team selected by the author.
   - Main task requires an explicit `why_it_matters` statement. Each plan has exactly one `main` task, sub-goals, and go-to-market tasks.
   - When marking a plan as `done`, the author explicitly indicates whether the main task shipped (`main_shipped: true / false`).

4. **Staff Privacy & Metadata Only**:
   - Platform staff in `/internal` never see plan text, task descriptions, or AI prompt/completion content. Staff see tenant metrics, AI call counts, error classifications, latency, and token totals only.

5. **AI Feature Integration**:
   - Powered by Pydantic AI with typed schemas (`PlanReview` and `PlanDraft`).
   - Fallback and rate limits: works gracefully without an active API key or if Gemini returns 429/timeout.
   - Failure events write structured audit rows to `ai_calls` without breaking the UI.

---

## 6. What Was Built vs. Out of Scope

- **Built**:
  - Full backend REST API (`/app` and `/internal` surfaces) with async SQLAlchemy and Alembic.
  - Complete customer dashboard: week selection, task ticking, AI drafting from messy notes, AI reviews with selective apply buttons, plan approvals/send-backs.
  - Organization settings, invite link generation, role assignment, member management.
  - Floating dashboard sidebar with rounded corners and official StickPeel branding.
  - Full internal administration console with organization suspension, user deactivation, staff management, and AI usage dashboards.
  - Unified marketing landing page with direct links to all applications.
  - Comprehensive automated test suite verifying tenancy, permissions, AI fallback, and audit logging.

- **Out of Scope (By Design)**:
  - Real email sending (invites use copyable links).
  - Billing / Stripe integration.
  - OAuth / Social SSO providers.
