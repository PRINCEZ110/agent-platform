# Deployment Guide

Verified 2026-10-05 against `package.json`, `tsconfig*.json`, `vitest.config.ts`.

## 1. Requirements

- Node.js **>= 20** (`engines`), npm 10 (`packageManager`)
- Git (worktree-based workflow)
- Network access only for LLM/search API calls; the platform itself runs offline

## 2. Install

```bash
git clone <repo> && cd AI
npm install          # runs `prepare` → npm run build automatically
```

`npm install` triggers a full `tsc + tsc-alias` build; if it fails, fix/typecheck first (`npm run typecheck`).

## 3. Configuration

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | LLM providers (concrete providers pending restore) |
| `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` | Azure OpenAI |
| `OLLAMA_BASE_URL` | Local models (default `http://localhost:11434/v1`) |
| `BING_SEARCH_API_KEY`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX` | Web search tool |
| `LOG_LEVEL`, `NODE_ENV` | Runtime behavior |

Never commit `.env` (already gitignored). `.env.example` placeholders only — no secrets in source.

Platform-level config files (all in the gitignored-or-shared control center):

| File | Purpose |
| --- | --- |
| `.ai/ownership.json` | File ownership globs (shared — coordinate changes) |
| `.ai/active-tasks.json` | Task registry |
| `.ai/permissions/agent-{a,b}.json` | Per-agent permission sets (written by `PermissionsManager`) |
| `.ai/config/` | App config ⏳ (module pending restore) |

## 4. Scripts

| Script | What it does | When to run |
| --- | --- | --- |
| `npm run build` | `tsc -p tsconfig.build.json` + `tsc-alias` → `dist/` | Before `npm start` / publishing |
| `npm run build:watch` | Incremental build | Development |
| `npm run typecheck` | `tsc --noEmit` (strict) | Before every commit |
| `npm run lint` / `lint:fix` | ESLint on `src/` | Before every commit |
| `npm test` | Vitest unit suites (`tests/**`, excludes `tests/integration/**`) | Before every commit |
| `npm run test:watch` | Vitest watch mode | During development |
| `npm run test:coverage` | Coverage with 80% thresholds | Before REVIEW |
| `npm run test:integration` | `vitest.integration.config.ts` suites | TASK-018 deliverable |
| `npm start` | `node dist/index.js` (requires build) | Production-style run |
| `npm run dev` | `tsx watch src/index.ts` | Development run |
| `npm run clean` | Remove `dist`, `coverage`, `.turbo` | Housekeeping |

> `npm run lint` currently reports pre-existing prettier violations across Agent A's `src/` (reported to Agent A). Unit tests, typecheck, and build are green.

## 5. Build outputs

```
dist/                      # JS + .d.ts + source maps, aliases rewritten by tsc-alias
  index.js                 # package barrel (root import)
  core/ comm/ tasks/ memory/ obs/ safety/ tools/ providers/ agents/
coverage/                  # v8 text/json/html reports
```

`package.json` `exports` map root + subpaths (`./core`, `./comm`, ...). Note: subpaths whose modules lack an `index.ts` barrel (`./providers`, `./obs`, `./git`, `./agents`) fail at runtime until barrels exist — use the root import.

## 6. Running

```bash
npm run build
npm start          # compiled ESM entry — verifies the full alias-resolution chain
npm run dev        # tsx watch entry — verifies export type-safety of the barrel
```

Read-only smoke test without starting agents:

```bash
npx tsx scripts/run-demo.ts
```

Prints ownership resolution, task-registry state, a health aggregation, Prometheus exposition, and a vector search — no control-center mutation.

## 7. Verification gates (Definition of Done)

A deployment-worthy state requires all of:

1. `npm run typecheck` → exit 0 (strict)
2. `npm test` → all green (`it.fails` cases must still be failing = open bugs documented, not silent)
3. `npm run build` → exit 0
4. `npm run test:coverage` → ≥ 80% on non-excluded `src/`
5. `npm start` → exit 0 (post `tsc-alias`)

## 8. Worktree / multi-agent deployment layout

```bash
git worktree add worktrees/agent-a/project feature/agent-a/setup
git worktree add worktrees/agent-b/project agent-b/ui-work
```

- Worktrees are gitignored from the main checkout (see `.gitignore`).
- Each worktree runs the same `npm install` (or shares a linked `node_modules`).
- Only the integration lead merges to `main`.
- Stale locks: `FileLockManager.cleanup()` removes expired entries (default TTL 1 h); `.ai/locks/*.lock` files are removed manually when a task completes.

## 9. Monitoring in production

```bash
curl localhost:<port>/metrics   # Prometheus exposition — via AgentMetrics.getMetrics()
curl localhost:<port>/health    # HealthStatus JSON — via HealthMonitor.getHealth()
```

> HTTP endpoints and the CLI (`npx agent-platform ...`, `npm start` server mode) are **pending restore** (`src/app/` in `_excluded/`). Today `npm start` runs the entry and exits cleanly; wiring the HTTP surface is Agent A's TASK-016 follow-up. Until then, embed `AgentMetrics` / `HealthMonitor` in your own process and expose them yourself (see `docs/examples/health-metrics.ts`).

## 10. Operational caveats

- **Persistence is file-based** (`.ai/`): back up that directory; multiple processes writing registries concurrently should coordinate through `FileLockManager`.
- **Coverage gates block CI** if `_excluded/` is ever un-excluded without tests — keep `coverage.exclude` and `tsconfig.json` `exclude` in sync when files are restored.
- **Open bugs**: see `docs/architecture.md` §9 and the `it.fails` tests — metrics helper labels, memory search values, regex escaping, indexer reindex, health precedence, `safePath` prefix, chunk overlap, class-name detection, message-bus persistence Result.
