# AGENTS.md

Two-agent collaborative project. Agent A = Lead Engineer (architecture, core logic, API/state contracts, integration, release). Agent B = Specialist Engineer (assigned modules, UI/UX, tests, performance, tooling, documentation).

## Control center: `.ai/`

| File | Purpose |
| --- | --- |
| `.ai/ownership.json` | File/glob ownership. Never edit another agent's files without explicit coordination. |
| `.ai/active-tasks.json` | Task registry (id, owner, files, status, deps, expected output). |
| `.ai/decisions.md` | Architecture Decision Records (ADR-NNN). |
| `.ai/changelog.md` | Cross-agent change log. |
| `.ai/locks/` | Per-task file locks while work is in progress. |
| `.ai/communication/` | Short, actionable agent-to-agent messages. |

Statuses: `PLANNED · READY · IN_PROGRESS · BLOCKED · REVIEW · COMPLETED · ABANDONED`.
A task is `COMPLETED` only when implementation exists, tests pass, build passes, no regressions, docs updated.

## Before coding

1. Read this file. 2. Check `.ai/ownership.json`. 3. Check `.ai/active-tasks.json`.
4. `git status` + recent history. 5. Read existing code you will touch.
6. Identify files to modify; confirm no active lock/ownership conflict.
7. Create/update your task entry + lock in `.ai/locks/`.

If ownership is unclear: do not modify; coordinate via `.ai/communication/`.

## Git

- Shared layout: `worktrees/agent-a/project`, `worktrees/agent-b/project` (gitignored from `main` checkout).
- Branches: `feature/agent-a/<task>` and `feature/agent-b/<task>`. Agent B's standing branch: `agent-b/ui-work`.
- Never run `git reset --hard`, `git checkout -- .`, `git clean -fd`, or discard another agent's changes.
- Commits: one logical purpose, conventional style (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Only the integration lead merges to `main`.

## Rules that matter most

- Never modify another agent's owned file without permission; shared files require coordination.
- Never silently change a shared interface (API shape, types, schema, routes, config, env vars).
- Never rewrite another agent's working code for style; prefer small patches.
- Never guess architecture: smallest safe assumption, documented as an ADR or task note.
- Test before reporting done: unit/integration tests, typecheck, lint, build.
- No secrets in source; `.env.example` only.

## Reporting

Finished: `TASK / STATUS / CHANGED / IMPLEMENTED / TESTED / RESULT / NOTES / NEXT`.
Blocked: `TASK / STATUS / BLOCKER / DEPENDENCY / REQUIRED`.
