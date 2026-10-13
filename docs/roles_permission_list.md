Viewed commands.py:140-235

In this project, Role-Based Access Control (RBAC) is structured across **3 distinct hierarchical scopes**:

1. **`org`** (Organization level — customer role attached via [`memberships`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/models/membership.py))
2. **`team`** (Team level — customer role attached via [`team_members`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/models/team.py))
3. **`platform`** (Platform level — internal staff role attached via [`platform_members`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/models/platform_member.py))

All roles are stored in the [`roles`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/models/rbac.py) table with their associated `scope`.

---

### Summary of Roles by Scope

| Scope | Role Name | Level / Context | Mapping Table | Description |
|---|---|---|---|---|
| **`org`** | `owner` | Organization | `memberships` | Organization owner with full org management, role assignment, transfer, and delete rights. |
| **`org`** | `admin` | Organization | `memberships` | Organization admin for managing members, teams, settings, and invites (cannot transfer/delete org). |
| **`org`** | `member` | Organization | `memberships` | Standard organization member who creates and manages their own weekly plans. |
| **`team`** | `team_lead` | Team | `team_members` | Team lead who reviews, approves, and returns plans for members of that team (one per team). |
| **`team`** | `team_member` | Team | `team_members` | Regular team member with view rights into the team. |
| **`platform`** | `super_admin` | Platform | `platform_members` | Full platform access (internal orgs, users, staff management, AI usage, suspend, audit). |
| **`platform`** | `operations` | Platform | `platform_members` | Operational management (view/suspend orgs, view/deactivate users, AI usage, audit). |
| **`platform`** | `support` | Platform | `platform_members` | Customer support staff (view orgs, view users, deactivate accounts; no suspend or AI metrics). |
| **`platform`** | `viewer` | Platform | `platform_members` | Read-only staff console access (view orgs, view users, view AI usage). |

---

### Detailed Permission Breakdown per Role

#### 1. Scope: `org`
- **`member`**:
  - `org.view`
  - `plan.manage_own`
  - `plan.ai_use`
- **`admin`** *(inherits member permissions + management)*:
  - `org.view`, `plan.manage_own`, `plan.ai_use`
  - `invite.manage`
  - `member.manage`
  - `org.settings`
  - `team.manage`
  - `team.lead.assign`
- **`owner`** *(inherits admin permissions + destructive/ownership rights)*:
  - All `admin` permissions
  - `org.role.assign`
  - `org.transfer`
  - `org.delete`

#### 2. Scope: `team`
- **`team_member`**:
  - `team.view`
- **`team_lead`**:
  - `team.view`
  - `plan.view_team`
  - `plan.approve`
  - `plan.return`
  - `team.week.view`
  - `team.history.view`

#### 3. Scope: `platform`
- **`viewer`**:
  - `platform.org.view`
  - `platform.user.view`
  - `platform.ai_usage.view`
- **`support`**:
  - `platform.org.view`
  - `platform.user.view`
  - `platform.user.deactivate`
- **`operations`**:
  - `platform.org.view`
  - `platform.org.suspend`
  - `platform.user.view`
  - `platform.user.deactivate`
  - `platform.ai_usage.view`
  - `platform.audit.view`
- **`super_admin`**:
  - `platform.org.view`
  - `platform.org.suspend`
  - `platform.user.view`
  - `platform.user.deactivate`
  - `platform.ai_usage.view`
  - `platform.staff.manage`
  - `platform.audit.view`