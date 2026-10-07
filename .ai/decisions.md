# Architecture Decisions

## ADR-001

Date: 2026-10-05

Decision: Treat `C:\Users\acer\OneDrive\Documents\Selected Works\AI` as the project root and bootstrap the collaboration control center before any feature work.

Reason: The folder was empty — no AGENTS.md, no `.ai/` registries, no git repo. The protocol requires these before coding.

Alternatives considered: Starting feature code immediately (rejected: would mean guessing architecture, forbidden by rule 21); waiting entirely with no setup (rejected: blocks both agents from coordinating).

Impact: Creates the baseline commit on `main`. No application code, no API contracts, no dependencies introduced.

Affected files: AGENTS.md, .gitignore, .ai/*, docs/*, tests/

## ADR-002

Date: 2026-10-05

Decision: Publish a PROVISIONAL ownership split in `.ai/ownership.json` mirroring the protocol's role descriptions, plus an explicit `shared` section.

Reason: Ownership registry is required before coding, but no `src/` tree exists yet to map. Provisional globs give both agents a starting contract; they change only by explicit coordination.

Alternatives considered: Leaving ownership.json absent (rejected: makes every future edit ambiguous); declaring full ownership myself (rejected: incompatible with shared-lead model).

Impact: Agent A should review/adjust globs when the real architecture lands; record any change here and in `.ai/communication/`.

Affected files: .ai/ownership.json

## ADR-003

Date: 2026-10-05

Decision: Build a **modular, model-agnostic autonomous AI agent platform** with two cooperating agents (Lead Architect + Specialist Engineer) using git worktrees for isolation.

Reason: Requirements demand: model-agnostic LLM routing, agent planning/decomposition, tool calling, terminal execution, filesystem access, Git integration, isolated worktrees, task ownership, inter-agent communication, project memory, context management, autonomous implementation, testing/validation, error recovery, reviewer workflow, safety boundaries, observability.

Alternatives considered: 
- Tight coupling to Azure AI Foundry (rejected: violates model-agnostic requirement)
- Single-agent monolithic system (rejected: cannot demonstrate multi-agent coordination)
- Shared working directory (rejected: high conflict risk, no isolation)

Impact: Core architecture split into: `core/` (runtime, types, interfaces), `agents/` (agent implementations), `tools/` (tool system), `git/` (worktree/branch management), `comm/` (inter-agent communication), `memory/` (project memory), `tasks/` (task ownership), `providers/` (LLM provider abstraction), `safety/` (permission boundaries), `obs/` (observability).

Affected files: .ai/ownership.json, package.json, tsconfig.json, src/*

## ADR-004

Date: 2026-10-05

Decision: Use **TypeScript/Node.js** as the implementation runtime with **ESM modules**, **strict TypeScript**, and **Zod** for runtime validation.

Reason: TypeScript provides: strong typing for agent interfaces, excellent LLM provider SDK support, mature tooling, good test ecosystem. ESM aligns with modern Node.js. Zod enables schema validation at boundaries (LLM responses, tool inputs, inter-agent messages).

Alternatives considered: Python (rejected: weaker TypeScript-level type safety for complex agent interfaces), Deno (rejected: smaller ecosystem), Go (rejected: more verbose for rapid agent iteration).

Impact: Package manager: npm. Test runner: Vitest. Lint: ESLint + TypeScript ESLint. Build: tsc. All source in `src/` with path aliases.

Affected files: package.json, tsconfig.json, .eslintrc.json, vitest.config.ts

## ADR-005

Date: 2026-10-05

Decision: **LLM Provider Abstraction Layer** — all model interactions go through a `ModelProvider` interface with pluggable implementations (OpenAI, Anthropic, Azure OpenAI, local models, etc.).

Reason: Model-agnostic requirement. Agents must not know or care which model they use. Enables: cost optimization, capability routing, fallback chains, local development with Ollama, provider-specific features.

Alternatives considered: Direct SDK calls in agents (rejected: couples agents to providers), LangChain/LangGraph (rejected: adds heavy abstraction, hides control flow).

Impact: New interface: `src/providers/model-provider.ts` with `chat()`, `stream()`, `embed()`, `countTokens()`. Provider configs in `src/providers/config.ts`. Factory in `src/providers/factory.ts`.

Affected files: src/providers/*, src/agents/* (depend on abstraction)

## ADR-006

Date: 2026-10-05

Decision: **Tool System** — tools are first-class, typed, discoverable capabilities with JSON Schema definitions, executed in isolated contexts with timeouts and resource limits.

Reason: Agents need: terminal execution, filesystem ops, git operations, web search, code analysis. Tools must be: composable, auditable, sandboxable, retryable, observable.

Alternatives considered: Function calling only (rejected: no isolation, no timeouts, no resource limits), MCP (rejected: overkill for internal tools, adds protocol overhead).

Impact: `src/tools/` with: `Tool` interface, `ToolRegistry`, `TerminalTool`, `FilesystemTool`, `GitTool`, `WebSearchTool`, `CodeAnalysisTool`. Each tool: schema (Zod), execute(), timeout, permissions.

Affected files: src/tools/*, src/agents/*.ts (use tools)

## ADR-007

Date: 2026-10-05

Decision: **Git Worktree Isolation** — each agent works in a dedicated git worktree on a feature branch. Integration lead merges to main after review.

Reason: Prevents overwrite/corruption. Enables: parallel work, clean history, easy rollback, code review, CI per agent. Matches the protocol's worktree structure.

Alternatives considered: Shared directory with file locks (rejected: coarse, error-prone), separate repos (rejected: complex sync), single branch (rejected: no isolation).

Impact: `src/git/` with: `WorktreeManager`, `BranchManager`, `MergeCoordinator`. CLI commands for: create-worktree, sync, propose-merge, review-diff.

Affected files: src/git/*, src/tasks/task-ownership.ts

## ADR-008

Date: 2026-10-05

Decision: **Inter-Agent Communication** via structured message bus with: task assignments, status updates, code reviews, context sharing, escalation. Persisted to `.ai/communication/`.

Reason: Agents need coordinated workflow: task delegation, review requests, blocking notifications, context handoff. File-based for simplicity, durability, auditability.

Alternatives considered: In-memory events (rejected: not durable, no cross-process), message queue (rejected: infrastructure overhead), direct function calls (rejected: no isolation).

Impact: `src/comm/` with: `MessageBus`, `Message` types (TaskAssign, StatusUpdate, ReviewRequest, ContextHandoff, Escalation), file persistence, subscription.

Affected files: src/comm/*, .ai/communication/*, src/tasks/*

## ADR-009

Date: 2026-10-05

Decision: **Task Ownership Registry** — every file/glob has an owner (agent_a, agent_b, shared). Tasks declare owned files. Locks prevent concurrent edits. Integration lead merges.

Reason: Enforces protocol rules: no unauthorized edits, clear boundaries, coordination for shared files. Prevents conflicts before they happen.

Alternatives considered: Git-only ownership (rejected: no prevention, only detection), manual coordination (rejected: scales poorly, error-prone).

Impact: `src/tasks/` with: `OwnershipRegistry`, `TaskRegistry`, `FileLockManager`. Reads `.ai/ownership.json`, `.ai/active-tasks.json`, `.ai/locks/`. CLI: claim-task, release-task, check-ownership.

Affected files: src/tasks/*, .ai/ownership.json, .ai/active-tasks.json, .ai/locks/*

## ADR-010

Date: 2026-10-05

Decision: **Project Memory & Context Management** — persistent, queryable memory: codebase embeddings, decision history, task outcomes, agent preferences. Vector store + structured log.

Reason: Agents need: codebase understanding (semantic search), decision recall (why was X done?), context continuity across sessions, learning from past outcomes.

Alternatives considered: Full context window stuffing (rejected: token limits, cost), external RAG only (rejected: misses structured decision data), no memory (rejected: agents relearn every session).

Impact: `src/memory/` with: `MemoryStore` (vector + structured), `CodebaseIndexer` (embeddings), `DecisionLog`, `ContextBuilder` (assembles relevant context for tasks). Provider-agnostic vector interface.

Affected files: src/memory/*, src/agents/* (use context)

## ADR-011

Date: 2026-10-05

Decision: **Safety & Permission Boundaries** — capability-based permissions: each tool declares required permissions. Agents run with scoped permission sets. Dangerous ops require explicit approval.

Reason: Autonomous agents can cause damage: delete files, push bad code, expose secrets. Permissions: filesystem (read/write/root), git (read/commit/push), terminal (allowlist/denylist), network (allowlist).

Alternatives considered: Full trust (rejected: unsafe), container sandbox per action (rejected: latency, complexity), no boundaries (rejected: irresponsible).

Impact: `src/safety/` with: `PermissionSet`, `PermissionChecker`, `ApprovalGate`, `AuditLog`. Config: `.ai/permissions/agent-a.json`, `.ai/permissions/agent-b.json`.

Affected files: src/safety/*, src/tools/* (declare permissions), .ai/permissions/*

## ADR-012

Date: 2026-10-05

Decision: **Observability** — structured logging (pino), metrics (prom-client), traces (OpenTelemetry), health checks. All agent actions, tool calls, LLM requests, decisions logged.

Reason: Debugging autonomous agents requires: replay, performance analysis, cost tracking, error diagnosis, audit trail. Essential for production reliability.

Alternatives considered: Console.log (rejected: unstructured, no query), vendor APM only (rejected: vendor lock-in, cost), no observability (rejected: blind spots).

Impact: `src/obs/` with: `Logger`, `Metrics`, `Tracer`, `HealthCheck`. Integrated into: agent runtime, tool executor, provider calls, git operations, task transitions.

Affected files: src/obs/*, all src/* (instrumented)
