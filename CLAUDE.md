@AGENTS.md

# Claude Code notes

- Follow every rule in AGENTS.md above. If a folder has its own AGENTS.md (for example `api/AGENTS.md`), read it before editing that folder.
- Plan mode first for anything that touches the data model, roles, permissions or tenancy. Show the plan, wait for approval, then build.
- Before saying a task is done: run `cd api && uv run pytest`, and if the API changed, run `npm run generate` and check the front ends still build.
- Every new endpoint needs a permission dependency and a tenancy test in the same commit.
- Never put `is_admin` (platform staff) and org admin (customer role) in the same code path. Keep the names separate.
- Never call Gemini from tests. Use `TestModel` or `FunctionModel`.
- Never read, print or commit `api/.env`.
- Commit in small steps. One concern per commit.
- When I correct you, add the lesson to AGENTS.md so it is not repeated.