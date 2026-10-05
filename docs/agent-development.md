# Agent Development Guide

How to build an agent (or extend the platform) inside this two-agent collaboration. Verified against the codebase 2026-10-05.

## 1. The two roles

| | Agent A (Lead) | Agent B (Specialist) |
| --- | --- | --- |
| Owns | `src/core, comm, tasks, obs, types, providers, tools, git, memory, safety, agents/lead, app, migrations` | `src/agents/specialist, ui, components, styles, features, tests, docs, scripts, examples` |
| Shared (edit only with coordination) | `AGENTS.md`, `.ai/**`, `package.json`, `tsconfig*`, `*.config.*`, `README.md`, `src/agents/base/**`, `src/agents/interfaces/**` |

Ownership source of truth: `.ai/ownership.json`, enforced programmatically by `OwnershipRegistry`.

## 2. Implementing an agent

### 2.1 Contract

Every agent implements `IAgent` (see [API Reference → agents](./api-reference.md#agents--srcagentsinterfacesagent-interfacets)) with optional `IPlanner` / `IExecutor` / `IReflector` role interfaces. Lifecycle:

```ts
initialize(config) → startTask(taskContext)
                   → executeStep(planStep)*     // planner/executor loop
                   → reflect(executionResult)  // on completion or failure
                   → handleError(err, ctx)      // on thrown/recovered errors
                   → shutdown()
```

`AgentState.status` moves through `idle → planning → acting → reflecting → completed`, with `blocked` / `error` escapes.

### 2.2 BaseAgent

`BaseAgent` (shared, `src/agents/base/`) provides the execution loop, lifecycle hooks, error handling, and message plumbing so concrete agents only define behavior. **Status: pending restore** — `base-agent.ts` and companions are currently in `src/_excluded/` (owned/restored by Agent A). Until restored:

- Concrete agent classes (`SpecialistAgent`, `LeadArchitectAgent`) are blocked from landing (`extends BaseAgent` is the specified design in TASK-012).
- Do not invent a replacement base class; restore or coordinate first.

### 2.3 Configuration

```ts
const config: AgentConfig = {
  id: 'agent_b',
  name: 'Specialist',
  role: 'specialist',
  modelProvider,          // any ModelProvider implementation
  model: 'gpt-4o',
  tools: [readFileTool, analyzeFileTool],
  messageBus,             // createMessageBus('agent_b')
  memory: createMemoryStore(new InMemoryVectorStore()),
  systemPrompt: '...',
  maxIterations: 10,
  temperature: 0.2,
};
```

### 2.4 Working on a task (checklist)

1. Read `AGENTS.md`, `.ai/ownership.json`, `.ai/active-tasks.json`.
2. `git status` + recent history. Read the code you will touch.
3. Claim: set your task to `IN_PROGRESS` (registry) and create `.ai/locks/<TASK-ID>.lock`.
4. Implement only in your owned paths; for shared files, coordinate via `.ai/communication/` first.
5. Never guess architecture — smallest safe assumption, documented as ADR (`.ai/decisions.md`) or task note.
6. Verify: `npm run typecheck && npm test && npm run build` (+ `npm run lint` for `src/`).
7. Path-scoped commit: `git commit -m "feat: ..." -- <your/paths>`. Never commit another agent's pending changes.
8. Report in `.ai/communication/agent-b-to-agent-a.md` (or the A→B equivalent):

```
TASK / STATUS / CHANGED / IMPLEMENTED / TESTED / RESULT / NOTES / NEXT   (finished)
TASK / STATUS / BLOCKER / DEPENDENCY / REQUIRED                          (blocked)
```

9. Move the task to `REVIEW`; counterparty confirms → `COMPLETED`, release/remove the lock.

### 2.5 Sending structured messages

```ts
import { createMessageBus, createTaskAssign, createStatusUpdate } from 'agent-platform';

const bus = createMessageBus('agent_a');
bus.subscribe('status_update', async (msg) => { /* react */ });

await bus.send('agent_b', createTaskAssign('agent_a', 'agent_b', {
  taskId: 'TASK-012',
  description: 'Implement SpecialistAgent',
  files: ['src/agents/specialist/specialist-agent.ts'],
  priority: 'high',
}));
```

Persistence to `.ai/communication/` happens inside `publish`/`send`. Durable cross-session handoff = the markdown files; the bus is the runtime channel.

## 3. Writing tools

```ts
import { createTool, toolRegistry } from 'agent-platform';
import { z } from 'zod';

const shoutTool = createTool(
  'shout',                                            // name
  'Uppercase the input text',                         // description
  z.object({ text: z.string().max(200) }),            // Zod input schema
  [],                                                 // ToolPermission[] ('fs.read', 'git.push', ...)
  async ({ text }) => ({ ok: true, value: { success: true, output: text.toUpperCase() } }),
  { timeout: 5_000 }
);

toolRegistry.register(shoutTool);
const result = await toolRegistry.execute({ id: '1', name: 'shout', input: { text: 'hi' } });
```

Rules:

- Validate inputs with Zod (`inputSchema`); `registry.execute` calls `validate` for you.
- Declare the minimum `permissions`; anything in your `PermissionSet.approvalRequired` routes through `ApprovalGate`.
- Return `ResultOrError`, never throw across the tool boundary.
- Add a unit test in `tests/tools/` mocking `fs/promises` if you touch the filesystem.

## 4. Using memory and context

```ts
const vector = new InMemoryVectorStore();
const memory = createMemoryStore(vector);
await memory.set('bug-009', { where: 'filesystem-tool safePath' }, { vector: true });

const hits = await memory.search('safe path');        // see BUG-005 caveat

const indexer = createCodebaseIndexer(vector);
await indexer.index();
const code = await indexer.search('message bus publish', 5);

const bundle = await createContextBuilder(memory, indexer, createDecisionLog()).buildContext(taskContext);
// bundle.relevantCode / relevantDecisions / memory / projectStructure
```

## 5. Safety integration

```ts
const check = await permissionChecker.checkAndRequireApproval('agent_b', ['fs.write']);
if (!check.ok) { /* denied or needs approval */ }

const req = await approvalGate.request('agent_b', 'git.push', 'git-tool', { branch });
await approvalGate.waitForDecision(req.value.id, 60_000);

await auditLog.log({ agentId: 'agent_b', action: 'git.push', resource: 'origin/agent-b/ui-work',
  permissions: ['git.push'], outcome: 'approved', riskLevel: 'medium', details: {} });
```

## 6. Observability

```ts
defaultMetrics.incCounter('model_calls', { agent: 'agent_b', model: 'gpt-4o' });
const span = defaultTracer.startSpan('specialist.executeStep', { attributes: { task: taskId } });
span.end();
healthMonitor.register({ name: 'vector-store', critical: false, check: async () => ({ status: 'healthy', timestamp: new Date() }) });
const status = await healthMonitor.getHealth();
```

## 7. Testing patterns

```ts
// tests/<module>/your.test.ts
vi.mock('fs/promises', () => ({ default: { readFile: vi.fn(), writeFile: vi.fn(), ... } }));

beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });   // fake timers already global via tests/setup.ts

it('does the thing', async () => { ... });           // normal expectation
it.fails('BUG-009: safePath prefix bypass', async () => { ... });  // documents an open bug
```

- Unit suites: `tests/**` (Agent B ownership), auto-picked up by `npm test`.
- Integration suites: `tests/integration/**`, run by `npm run test:integration`.
- Coverage thresholds: 80% lines/functions/branches/statements (`src/_excluded/**` excluded).
- When a documented bug gets fixed, the `it.fails` case turns red — flip it to plain `it()`.

## 8. Branch & worktree hygiene

```bash
git worktree add worktrees/agent-b/project agent-b/ui-work   # your isolation
# work on feature/agent-b/<task> branches; only the lead merges to main
# forbidden: git reset --hard | git checkout -- . | git clean -fd
```

## 9. Current platform gaps to know about

See [Architecture → Known gaps](./architecture.md#9-known-gaps-inventory). The short list: BaseAgent & the runtime loop, concrete providers, terminal/git tools, `src/app/`, `src/git/` are pending restore; several reported bugs remain open and are pinned by `it.fails` tests.
