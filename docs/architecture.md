# Architecture Guide

> Status: verified against the codebase on 2026-10-05 (TASK-019).
> Sections that depend on code still parked in `src/_excluded/` are marked **pending restore** rather than described from memory.

## 1. Overview

A modular, model-agnostic autonomous AI agent platform for collaborative software development, operated by two cooperating agents:

- **Agent A — Lead Engineer**: architecture, core logic, API/state contracts, integration, release.
- **Agent B — Specialist Engineer**: assigned modules, UI/UX, tests, performance, tooling, documentation.

Both agents coordinate through a file-based control center (`.ai/`), git worktrees, and an in-process message bus. Full collaboration rules live in `AGENTS.md`.

## 2. Runtime stack (ADR-004)

| Concern | Choice |
| --- | --- |
| Language | TypeScript 5.3, `strict` + `noUncheckedIndexedAccess` |
| Modules | ESM (`"type": "module"`, `module: NodeNext`) with path aliases (`@core/*`, `@comm/*`, ...) |
| Validation | Zod 3 (message schemas, tool schemas, provider schemas) |
| Tests | Vitest (global fake timers via `tests/setup.ts`, 80% coverage thresholds) |
| Build | `tsc -p tsconfig.build.json` + `tsc-alias` (rewrites aliases for `dist/`) |
| Metrics | `prom-client` |
| Tracing | OpenTelemetry (`@opentelemetry/*`) |
| Logging | `pino` (implementation `src/obs` logger: **pending restore** — `logger.ts` is in `_excluded/`) |

## 3. Module map

```
src/
├── core/        types (Result), error hierarchy, utils        ✅ tested
├── comm/        MessageBus, persistence, subscriptions        ✅ tested
├── tasks/       TaskRegistry, OwnershipRegistry, FileLocks    ✅ tested
├── memory/      MemoryStore, VectorStore, CodebaseIndexer,    ✅ tested
│                DecisionLog, ContextBuilder
├── obs/         HealthMonitor, AgentMetrics, AgentTracer      ✅ tested
├── safety/      Permissions, PermissionChecker, ApprovalGate, ✅ tested
│                AuditLog
├── tools/       Tool interface, ToolRegistry, filesystem,     ✅ tested
│                web-search, code-analysis tools
├── providers/   ModelProvider interface + Zod schemas         ✅ tested (interface only)
├── agents/
│   ├── interfaces/  IAgent, IPlanner, IExecutor, IReflector   ✅ tested
│   ├── base/        BaseAgent, execution loop, lifecycle      ⏳ pending restore
│   ├── lead/        LeadArchitectAgent                        ⏳ empty (Agent A)
│   └── specialist/  SpecialistAgent                           ⏳ empty (TASK-012)
├── git/         Worktree/Branch/Merge managers               ⏳ pending restore
├── app/         CLI, bootstrap, orchestrator                   ⏳ pending restore
└── _excluded/   26 files awaiting restore by Agent A          ⛔ not compiled/tested
```

`src/index.ts` is the package barrel — it only re-exports modules that are restored and working today. `tsconfig.json` excludes `src/_excluded/**`, and so do the coverage settings.

## 4. Core conventions

### 4.1 Result type instead of throwing

Almost every fallible API returns `ResultOrError<T>` rather than throwing:

```ts
type ResultOrError<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
ok(value); err(error); isOk(r); isErr(r);
```

Use `isOk(result)` (or `result.ok === true`) to narrow, then read `result.value` / `result.error`. Errors across the platform derive from `AgentError` subclasses (`ToolError`, `CommunicationError`, `TaskError`, `SafetyError`, ...), so callers can catch by family.

### 4.2 Singletons + factory functions

Each module exposes a class, a `create*` factory, and usually a lazy singleton (`taskRegistry`, `toolRegistry`, `healthMonitor`, ...). Prefer the singleton for platform wiring; prefer the factory in tests for isolation.

### 4.3 Persistence paths

Persistent state is file-based under `.ai/` (control center) — task registry, ownership config, locks, communication inboxes, audit log, approval requests, decision log. Modules that write there must be mocked (`vi.mock('fs/promises', ...)`) in unit tests so test runs never mutate the control center.

## 5. Key data flows

### 5.1 Task lifecycle

```
PLANNED → READY → IN_PROGRESS → REVIEW → COMPLETED
                 ↘ BLOCKED ↩        ↘ ABANDONED
```

1. `TaskRegistry.load()` reads `.ai/active-tasks.json`.
2. `canStart(id)` verifies all `dependencies` are `COMPLETED`.
3. Agent claims: status → `IN_PROGRESS` + creates `.ai/locks/<id>.lock`.
4. Agent works only on files owned per `.ai/ownership.json` (`OwnershipRegistry.canModify`).
5. Verification (typecheck/tests/build) → status `REVIEW`, report appended to `.ai/communication/`.
6. Counterparty confirms → `COMPLETED`, lock released.

### 5.2 Inter-agent messaging

```
createTaskAssign(...) → bus.send(to, msg) → persistence.saveMessage(to, msg)
                          → subscriber handlers / SubscriptionManager.notify
                          → bus.acknowledge(msg, accepted)
```

Message types (Zod discriminated union): `task_assign`, `status_update`, `review_request`, `context_handoff`, `escalation`, `acknowledgment`, `heartbeat`. The durable copy of every inbound message lands in the receiver's `.ai/communication/` inbox via `persistence`; the in-memory `messageHistory` (capped) serves `getHistory()`.

### 5.3 Tool execution

```
agent → toolRegistry.execute({ id, name, input })
      → tool.validate(input)          // Zod schema
      → PermissionChecker.check(...)  // safety layer
      → tool.execute(input)           // timeout enforced
      → ToolCallResult { success, output | error }
      → AuditLog.log(...) + metrics.toolCalls / toolDuration
```

### 5.4 Memory & context

- `InMemoryVectorStore` — content-similarity search (embedding optional via `EmbeddingVectorStore`).
- `CodebaseIndexer.index()` walks the repo (glob include/exclude), chunks files (~2000 chars, line-based), and pushes chunks into the vector store; `search()` ranks them.
- `MemoryStore` — structured key/value entries plus vector-backed `search()`.
- `DecisionLog` — durable ADR-like entries searchable by text/tag/task.
- `ContextBuilder.buildContext(task)` assembles `{ relevantCode, relevantDecisions, memory, ... }` into a `ContextBundle` for an agent about to plan.

### 5.5 Observability

- **Metrics**: `AgentMetrics` (prom-client). Built-ins: `toolCalls`, `toolDuration`, `modelCalls`, `modelTokens`, `modelDuration`, `taskDuration`, `errors`, `activeAgents`. Exposition text via `await getMetrics()`.
- **Tracing**: `AgentTracer.startSpan(name)` wraps OTel spans; `shutdown()` flushes.
- **Health**: `HealthMonitor` with named checks (`critical` flag). `getHealth()` aggregates into `healthy | degraded | unhealthy` + per-check results and uptime.

### 5.6 Safety

`PermissionSet` per agent (filesystem/git/terminal/network scopes + `approvalRequired` list). Flow: `PermissionChecker.checkAndRequireApproval()` → either allowed, or an `ApprovalGate.request()` that blocks until `approve()`/`deny()` (with `waitForDecision(timeout)`). Everything is recorded in `AuditLog` with `riskLevel`.

## 6. ADR summary

| ADR | Decision |
| --- | --- |
| 001 | Bootstrap project root + `.ai/` control center first |
| 002 | Provisional ownership split in `.ai/ownership.json` |
| 003 | Two-agent platform architecture (module split in §3) |
| 004 | TypeScript/ESM/strict/Zod stack |
| 005 | `ModelProvider` abstraction (no direct SDK calls in agents) |
| 006 | First-class typed tool system (schema, timeout, permissions) |
| 007 | Git worktree isolation per agent |
| 008 | Structured message bus persisted to `.ai/communication/` |
| 009 | Task ownership registry + locks |
| 010 | Project memory: vectors + decisions + context builder |
| 011 | Capability-based safety with approval gates |
| 012 | Observability: logs, metrics, traces, health |

Full text: `.ai/decisions.md`.

## 7. Two-agent collaboration architecture

- **Worktrees**: `worktrees/agent-a/project`, `worktrees/agent-b/project` (gitignored; each on its own branch). Only the integration lead merges to `main`.
- **Ownership**: `.ai/ownership.json` globs → `agent_a` / `agent_b` / `shared`. Enforced by `OwnershipRegistry.validateFileAccess()`.
- **Locks**: `.ai/locks/<TASK-ID>.lock` while a task is in progress; `FileLockManager` also supports TTL locks (`acquire/release/extend`, default 1 h).
- **Communication**: outbound/inbound markdown messages under `.ai/communication/`, mirrored by programmatic `MessageBus` traffic.
- **Reports**: finished → `TASK / STATUS / CHANGED / IMPLEMENTED / TESTED / RESULT / NOTES / NEXT`; blocked → `TASK / STATUS / BLOCKER / DEPENDENCY / REQUIRED`.

## 8. Testing architecture

- `tests/**` is Agent B's ownership. Unit suites live in `tests/<module>/**`, integration suites in `tests/integration/**` (excluded from the default run; executed by `npm run test:integration`).
- `tests/setup.ts` installs **global fake timers** — advance time explicitly (`vi.advanceTimersByTimeAsync`) or use `vi.useRealTimers()` locally.
- Filesystem-writing modules (`comm/persistence`, `tasks/*`, `safety/*`, `memory/*`) must be tested behind `vi.mock('fs/promises', ...)`.
- Known-bug documentation pattern: `it.fails('...')` marks a test whose body reproduces a reported bug — it passes while the bug exists and flips to a hard failure once fixed (then convert to plain `it()`).

## 9. Known gaps (honest inventory)

| Gap | Impact | Owner |
| --- | --- | --- |
| `src/_excluded/` (26 files): BaseAgent, execution loop, CLI, orchestrator, git module, concrete providers, terminal/git tools, logger/config | Agent runtime, `agent orchestration` integration tests, git workflow tests, docs sections below | Agent A |
| Subpath exports in `package.json` (`./providers`, `./obs`, `./git`, `./agents`, ...) lack barrels (`src/*/index.ts`) | Importing those subpaths from `dist/` fails | Agent A (shared file) |
| Reported bugs BUG-001, BUG-004…012 (metrics help/buckets, memory search values, regex escaping, indexer reindex, health precedence, `safePath` prefix, chunk overlap, class-name detection) | Behaviors documented in `tests/**` `it.fails` cases | Agent A |
