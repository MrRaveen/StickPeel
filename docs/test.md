Ran command: `uv run python -c "
from app.main import app, app_api, internal_api

def print_app_routes(name, api, prefix):
    print(f'=== {name} ({prefix}) ===')
    for route in api.routes:
        if hasattr(route, 'methods'):
            methods = ', '.join(sorted([m for m in route.methods if m not in ('HEAD', 'OPTIONS')]))
            if not methods:
                continue
            deps = []
            if hasattr(route, 'dependencies'):
                for d in route.dependencies:
                    dep = getattr(d, 'dependency', None)
                    if hasattr(dep, 'required_permission'):
                        deps.append(f'{dep.required_permission} ({getattr(dep, \"allowed_scopes\", \"platform\")})')
            dep_str = f' [Requires: {\", \".join(deps)}]' if deps else ''
            print(f'{methods:6} {prefix}{route.path}{dep_str} -> {route.name}')

print_app_routes('Customer App API', app_api, '/app')
print()
print_app_routes('Internal Admin API', internal_api, '/internal')
"`

Here is the complete list of all routes created and registered across the application so far, grouped by surface:

---

### 1. Customer App Surface (`/app`)

Implemented in [`app/api/app/routers/`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/)

| Method | Endpoint | Permission Required | Scope | Description | Source File |
|---|---|---|---|---|---|
| **POST** | `/app/login` | *None (Public)* | — | Unified login (supports customer & staff, issues JWT with user ID) | [`auth.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/auth.py) |
| **POST** | `/app/create-account` | *None (Public)* | — | Creates regular customer accounts (`is_admin=False`) | [`auth.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/auth.py) |
| **POST** | `/app/auth` | *None (Public)* | — | App surface credential authentication | [`meta.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/meta.py) |
| **POST** | `/app/logout` | *Authenticated* | — | Clears app authentication cookie | [`auth.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/auth.py) |
| **GET** | `/app/health` | *None (Public)* | — | Service health check | [`meta.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/meta.py) |
| **GET** | `/app/users/self` | *Authenticated* | — | Retrieves current customer profile | [`users.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/users.py) |
| **GET** | `/app/orgs` | *Authenticated* | — | Lists all organizations the caller belongs to with role & membership status | [`orgs.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/orgs.py) |
| **GET** | `/app/orgs/{org_id}/teams` | `team.manage` | `org` | Lists teams in the organization for the caller's membership | [`orgs.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/orgs.py) |
| **GET** | `/app/orgs/{org_id}/permissions` | `org.view` | `org` | Gets caller's permissions for the organization | [`orgs.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/orgs.py) |
| **GET** | `/app/orgs/{org_id}/teams/{team_id}/permissions` | `team.view` | `team` | Gets caller's permissions across both organization and team scopes | [`orgs.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/app/routers/orgs.py) |

---

### 2. Internal Staff Admin Surface (`/internal`)

Implemented in [`app/api/internal/routers/`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/)

#### Organizations
| Method | Endpoint | Permission Required | Scope | Description | Source File |
|---|---|---|---|---|---|
| **GET** | `/internal/orgs` | `platform.org.view` | `platform` | Lists all platform organizations | [`orgs.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/orgs.py) |
| **POST** | `/internal/orgs/{id}/suspend` | `platform.org.suspend` | `platform` | Suspends an organization | [`orgs.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/orgs.py) |
| **POST** | `/internal/orgs/{id}/reinstate` | `platform.org.suspend` | `platform` | Reinstates a suspended organization | [`orgs.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/orgs.py) |

#### Users
| Method | Endpoint | Permission Required | Scope | Description | Source File |
|---|---|---|---|---|---|
| **GET** | `/internal/users/self` | *Staff Authenticated* | — | Gets the calling staff member profile | [`users.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/users.py) |
| **GET** | `/internal/users` | `platform.user.view` | `platform` | Lists all platform users | [`users.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/users.py) |
| **GET** | `/internal/users/{id}` | `platform.user.view` | `platform` | Retrieves user details by ID | [`users.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/users.py) |
| **POST** | `/internal/users/{id}/deactivate` | `platform.user.deactivate` | `platform` | Deactivates a user account | [`users.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/users.py) |
| **POST** | `/internal/users` | *Staff Authenticated* | — | Creates a user record | [`users.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/users.py) |
| **PATCH** | `/internal/users/{user_id}` | *Staff Authenticated* | — | Updates a user record | [`users.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/users.py) |
| **POST** | `/internal/users/{user_id}/change-password` | *Staff Authenticated* | — | Admin-level password update | [`users.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/users.py) |
| **DELETE** | `/internal/users/{user_id}` | *Staff Authenticated* | — | Deletes a user record | [`users.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/users.py) |

#### AI Usage
| Method | Endpoint | Permission Required | Scope | Description | Source File |
|---|---|---|---|---|---|
| **GET** | `/internal/ai-usage` | `platform.ai_usage.view` | `platform` | Summarizes AI calls and errors per organization | [`ai_usage.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/ai_usage.py) |

#### Platform Staff Management
| Method | Endpoint | Permission Required | Scope | Description | Source File |
|---|---|---|---|---|---|
| **GET** | `/internal/staff` | `platform.staff.manage` | `platform` | Lists all platform staff members | [`staff.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/staff.py) |
| **POST** | `/internal/staff` | `platform.staff.manage` | `platform` | Creates a new staff member | [`staff.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/staff.py) |
| **GET** | `/internal/staff/{id}` | `platform.staff.manage` | `platform` | Gets staff member details | [`staff.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/staff.py) |
| **PATCH** | `/internal/staff/{id}` | `platform.staff.manage` | `platform` | Updates staff member role or profile | [`staff.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/staff.py) |
| **DELETE** | `/internal/staff/{id}` | `platform.staff.manage` | `platform` | Removes a staff member | [`staff.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/staff.py) |

#### Auth & Health
| Method | Endpoint | Permission Required | Scope | Description | Source File |
|---|---|---|---|---|---|
| **POST** | `/internal/auth` | *None (Admin credentials)* | — | Issues staff internal JWT token | [`meta.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/meta.py) |
| **POST** | `/internal/logout` | *Staff Authenticated* | — | Clears staff session cookie | [`meta.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/meta.py) |
| **GET** | `/internal/health` | *None (Public)* | — | Internal service health check | [`meta.py`](file:///run/media/ravinjayasanka/RAVEEN%20DATA/Work/College_works/xaventra/StickPeel/api/app/api/internal/routers/meta.py) |