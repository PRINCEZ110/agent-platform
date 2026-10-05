# API Reference

Generated from the restored source tree (verified 2026-10-05). All public surface also re-exports from the package root `src/index.ts` (→ `dist/index.js` after build).

Conventions:

- Fallible operations return `Promise<ResultOrError<T>>`: `{ ok: true, value }` or `{ ok: false, error }`. Narrow with `isOk()` / `isErr()`.
- Zod schemas (`*Schema`) are exported alongside their inferred types wherever runtime validation is available.
- ⏳ marks APIs that exist only in `src/_excluded/` and are pending restore.

---

## core

### `src/core/types.ts`

```ts
interface Result<T, E = Error> { ok: true;  value: T }
interface Err<T, E = Error>    { ok: false; error: E }
type ResultOrError<T, E = Error> = Result<T, E> | Err<T, E>;

ok<T>(value: T): Result<T>;
err<E>(error: E): Err<never, E>;
isOk<T, E>(r: ResultOrError<T, E>): r is Result<T, E>;
isErr<T, E>(r: ResultOrError<T, E>): r is Err<T, E>;
```

### `src/core/errors.ts`

`AgentError` base + subclasses: `ProviderError`, `ToolError`, `GitError`, `CommunicationError`, `MemoryError`, `TaskError`, `SafetyError`, `ValidationError`, `AppError`.

### `src/core/utils.ts`

```ts
generateId(prefix = ''): string;
sleep(ms: number): Promise<void>;
retry<T>(fn, opts?: { retries?, delayMs?, backoff? }): Promise<T>;
timeout<T>(promise: Promise<T>, ms: number): Promise<T>;   // rejects with TimeoutError
sanitizePath(path: string, root: string): string;          // resolves inside root
truncate(str: string, maxLength: number): string;
deepClone<T>(obj: T): T;
isRecord(value: unknown): value is Record<string, unknown>;
```

---

## comm — inter-agent communication

### Message schema (`src/comm/messages.ts`)

```ts
type MessageType = 'task_assign' | 'status_update' | 'review_request'
                 | 'context_handoff' | 'escalation' | 'acknowledgment' | 'heartbeat';

// factories (each validates via Zod and stamps id/timestamp/from)
createTaskAssign(from, to, payload: TaskAssignPayload): Message;
createStatusUpdate(from, payload: StatusUpdatePayload): Message;
createReviewRequest(from, to, payload: ReviewRequestPayload): Message;
createContextHandoff(from, to, payload: ContextHandoffPayload): Message;
createEscalation(from, to, payload: EscalationPayload): Message;
createAcknowledgment(from, to, payload: AcknowledgmentPayload): Message;
createHeartbeat(from, payload: HeartbeatPayload): Message;

interface Message { id; type; from; to?; timestamp; payload; correlationId?; ... }
interface SubscriptionFilter { types?; from?; to?; correlationId?; }
```

Per-type payload schemas: `TaskAssignPayloadSchema`, `StatusUpdatePayloadSchema`, `ReviewRequestPayloadSchema`, `ContextHandoffPayloadSchema`, `EscalationPayloadSchema`, `AcknowledgmentPayloadSchema`, `HeartbeatPayloadSchema`, plus `MessageSchema` (discriminated union).

### `MessageBus` (`src/comm/message-bus.ts`)

```ts
new MessageBus(agentId) / createMessageBus(agentId): MessageBus   // extends EventEmitter

subscribe(type: MessageType, handler: (m: Message) => Promise<void> | void): () => void; // returns unsubscribe
subscribeAll(handler): () => void;
unsubscribe(type: MessageType, handler): void;
publish(message: Message): Promise<ResultOrError<void>>;   // persist + dispatch to handlers
send(to: string, message: Message): Promise<ResultOrError<void>>;
acknowledge(original, accepted: boolean, message?): Promise<ResultOrError<void>>;
getHistory(type?: MessageType, limit = 100): Message[];
getAgentId(): string;
```

> Known issue BUG-001: `publish` currently ignores the `Result` from persistence (report filed with Agent A).

### `persistence` (`src/comm/persistence.ts`)

```ts
saveMessage(agentId, message): Promise<ResultOrError<void>>;
loadMessage(agentId, messageId): Promise<ResultOrError<Message>>;
loadMessages(agentId, limit = 1000): Promise<Message[]>;
loadInbox(agentId): Promise<string[]>;
markRead(agentId, messageId): Promise<ResultOrError<void>>;
clearInbox(agentId): Promise<ResultOrError<void>>;
```

### `SubscriptionManager` (`src/comm/subscription.ts`)

```ts
subscribe(id: string, filter: SubscriptionFilter, callback: (m: Message) => void): void;
unsubscribe(id: string): boolean;
notify(message: Message): void;
getSubscriptionIds(): string[];
clear(): void;
```

---

## tasks — registry, ownership, locks

### `TaskRegistry` (`src/tasks/task-registry.ts`) — persists `.ai/active-tasks.json`

```ts
interface Task {
  task_id: string;
  owner: 'agent_a' | 'agent_b';
  description: string;
  status: 'PLANNED'|'READY'|'IN_PROGRESS'|'BLOCKED'|'REVIEW'|'COMPLETED'|'ABANDONED';
  files: string[];
  dependencies: string[];
  expected_output: string;
  notes?: string;
  createdAt: Date; updatedAt: Date; startedAt?: Date; completedAt?: Date;
}

load(): Promise<ResultOrError<Task[]>>;
save(): Promise<ResultOrError<void>>;
getTask(id): Task | undefined;
getAllTasks(): Task[];
getTasksByOwner(owner): Task[];
getTasksByStatus(status): Task[];
createTask(task: Omit<Task,'createdAt'|'updatedAt'>): Promise<ResultOrError<Task>>;
updateTask(id, updates: Partial<Omit<Task,'task_id'|'createdAt'>>): Promise<ResultOrError<Task>>;
setStatus(id, status): Promise<ResultOrError<Task>>;
deleteTask(id): Promise<ResultOrError<void>>;
getDependencies(id): Task[];  getDependents(id): Task[];
canStart(id): boolean;        // all dependencies COMPLETED
getReadyTasks(owner?): Task[];
```

### `OwnershipRegistry` (`src/tasks/ownership-registry.ts`) — reads `.ai/ownership.json`

```ts
load(): Promise<ResultOrError<OwnershipConfig>>;
getConfig(): OwnershipConfig | null;
getOwner(filePath): 'agent_a' | 'agent_b' | 'shared' | 'unknown';
canModify(agentId, filePath): boolean;
getOwnedFiles(agentId): string[];
getSharedFiles(): string[];
updateConfig(config): Promise<ResultOrError<void>>;
validateFileAccess(agentId, files: string[]): { allowed: string[]; denied: string[] };
```

### `FileLockManager` (`src/tasks/file-lock-manager.ts`)

```ts
initialize(): Promise<ResultOrError<void>>;
acquire(file, taskId, agentId, ttlMs = 3_600_000): Promise<ResultOrError<FileLock>>;
release(file, taskId, agentId): Promise<ResultOrError<void>>;
forceRelease(file): Promise<ResultOrError<void>>;
extend(file, taskId, agentId, ttlMs?): Promise<ResultOrError<FileLock>>;
isLocked(file): boolean;  getLock(file): FileLock | undefined;
getLocksByTask(taskId): FileLock[];  getLocksByAgent(agentId): FileLock[];
cleanup(): Promise<number>;   // removes expired locks
```

---

## memory

### `VectorStore` (`src/memory/vector-store.ts`)

```ts
interface VectorStore {
  initialize(): Promise<ResultOrError<void>>;
  add(doc: VectorDocument): Promise<ResultOrError<void>>;
  addBatch(docs: VectorDocument[]): Promise<ResultOrError<void>>;
  delete(id): Promise<ResultOrError<void>>;
  search(query: string, limit: number): Promise<VectorSearchResult[]>;
  get(id): Promise<VectorDocument | undefined>;
  clear(): Promise<ResultOrError<void>>;
}
interface VectorDocument   { id; content; metadata: Record<string, unknown>; embedding?: number[] }
interface VectorSearchResult { id; score; content; metadata }

class InMemoryVectorStore implements VectorStore   // content-similarity, no embeddings needed
class EmbeddingVectorStore implements VectorStore  // cosine similarity over embedder output
createVectorStore(embedder?: (text) => Promise<number[]>): VectorStore;
```

> Known issues: BUG-006 (search input not regex-escaped) and BUG-007 (`reindexFile` stale chunks) — tests in `tests/memory/`.

### `MemoryStore` (`src/memory/memory-store.ts`)

```ts
initialize(): Promise<ResultOrError<void>>;
set(key, value, options?: { metadata?; ttl?; vector? }): Promise<ResultOrError<void>>;
get(key): Promise<unknown>;
delete(key): Promise<ResultOrError<void>>;
search(query, limit = 10): Promise<unknown[]>;
getAllKeys(): Promise<string[]>;
getEntriesByType('structured' | 'vector'): Promise<MemoryEntry[]>;
cleanup(): Promise<number>;            // drops expired entries
getVectorStore(): VectorStore;
```

> Known issue BUG-005: `search()` currently returns metadata objects, not values.

### `CodebaseIndexer` (`src/memory/codebase-indexer.ts`)

```ts
const DEFAULT_INDEX_CONFIG = {
  includePatterns: ['**/*.{ts,tsx,js,jsx,py,json,md,yaml,yml}'],
  excludePatterns: ['**/node_modules/**','**/dist/**','**/build/**','**/.git/**','**/coverage/**'],
  maxFileSize: 100_000, chunkSize: 2000, chunkOverlap: 200,
};

index(): Promise<ResultOrError<{ files: number; chunks: number }>>;
indexFile(filePath): Promise<number>;      // chunks added (does not update indexedFiles list)
reindexFile(filePath): Promise<number>;    // remove + re-add (BUG-007)
removeFile(filePath): Promise<void>;
search(query, limit = 10): Promise<Array<{ file; content; score }>>;
getIndexedFiles(): string[];
```

### `DecisionLog` (`src/memory/decision-log.ts`)

```ts
record(entry: Omit<DecisionEntry,'id'|'createdAt'>): Promise<ResultOrError<DecisionEntry>>;
get(id): Promise<DecisionEntry | undefined>;
search(query, tags?: string[], limit = 20): Promise<DecisionEntry[]>;
getByTag(tag, limit = 20): Promise<DecisionEntry[]>;
getByTask(taskId, limit = 20): Promise<DecisionEntry[]>;
getAll(limit = 50): Promise<DecisionEntry[]>;
```

### `ContextBuilder` (`src/memory/context-builder.ts`)

```ts
createContextBuilder(memory: MemoryStore, indexer: CodebaseIndexer, decisions: DecisionLog): ContextBuilder;

buildContext(task: TaskContext, options?: { maxCodeResults?; maxDecisions? })
  : Promise<ResultOrError<ContextBundle>>;
updateProjectStructure(): Promise<void>;

interface ContextBundle {
  task: TaskContext;
  relevantCode: Array<{ file; content; score }>;
  relevantDecisions: Array<{ id; title; decision; rationale }>;
  memory: Record<string, unknown>;
  agentPreferences: Record<string, unknown>;
  projectStructure: string;
  timestamp: Date;
}
```

---

## obs

### `HealthMonitor` (`src/obs/health.ts`)

```ts
register(check: HealthCheck): void;   // { name, check(): Promise<HealthCheckResult>, critical, interval? }
unregister(name): boolean;
runCheck(name): Promise<HealthCheckResult | undefined>;
runAllChecks(): Promise<HealthStatus>;
getHealth(): Promise<HealthStatus>;   // { status, checks, timestamp, uptime }
getLastResult(name) / getAllResults();
shutdown(): void;

// helpers
createDatabaseHealthCheck(name, check): HealthCheck;
createProviderHealthCheck(name, check): HealthCheck;
createDiskSpaceHealthCheck(thresholdPercent = 90): HealthCheck;
createMemoryHealthCheck(thresholdPercent = 90): HealthCheck;
```

> Known issue BUG-008: aggregation precedence can downgrade a healthy status to `degraded` by check ordering.

### `AgentMetrics` (`src/obs/metrics.ts`)

```ts
createMetrics(config?: Partial<{ prefix; defaultMetrics }>): AgentMetrics;  // defaultMetrics singleton

counter(name, help, labels = []): Counter;      // help MUST be non-empty
gauge(name, help, labels = []): Gauge;
histogram(name, help, labels = [], buckets?): Histogram;
incCounter(name, labels = {}): void;            // BUG-004: passes '' help internally
setGauge(name, value, labels = {}): void;
observeHistogram(name, value, labels = {}): void;
getMetrics(): Promise<string>;                  // Prometheus exposition format
getContentType(): Promise<string>;

// built-ins
toolCalls | errors: Counter        toolDuration | modelDuration | taskDuration: Histogram
modelCalls | modelTokens: Counter  activeAgents: Gauge
```

### `AgentTracer` (`src/obs/tracer.ts`)

```ts
createTracer(config?: Partial<{ serviceName; exporter }>): AgentTracer;   // defaultTracer singleton
getTracer(): OtelTracer;
startSpan(name, options?: { kind?; attributes?; parent? }): Span;
getCurrentSpan(): Span | undefined;
setSpanAttribute(key, value): void;
addEvent(name, attributes?): void;
shutdown(): Promise<void>;
```

---

## safety

### `PermissionsManager` (`src/safety/permissions.ts`)

```ts
interface PermissionSet {
  agentId: string;
  permissions: ToolPermission[];
  resourceLimits: { maxFileWrites?; maxShellCommands?; ... };
  approvalRequired: ToolPermission[];
}
DEFAULT_PERMISSIONS: Record<'agent_a'|'agent_b', PermissionSet>;

initialize() / savePermissions(agentId);
getPermissions(agentId): PermissionSet | undefined;
hasPermission(agentId, permission): boolean;
requiresApproval(agentId, permission): boolean;
checkResourceLimits(agentId, resource, value): boolean;
grantPermission / revokePermission / setResourceLimit;
```

### `PermissionChecker` (`src/safety/checker.ts`)

```ts
check(agentId, permissions: ToolPermission[]): Promise<ResultOrError<void>>;
checkAndRequireApproval(agentId, permissions): Promise<ResultOrError<ToolPermission[]>>;
checkResourceLimit(agentId, resource: string, value: number): Promise<ResultOrError<void>>;
```

### `ApprovalGate` (`src/safety/approval-gate.ts`)

```ts
request(agentId, permission, tool, context): Promise<ResultOrError<ApprovalRequest>>;
approve(requestId, decidedBy, reason?): Promise<ResultOrError<ApprovalRequest>>;
deny(requestId, decidedBy, reason?): Promise<ResultOrError<ApprovalRequest>>;
get(requestId) / getPending(agentId?): Promise<ApprovalRequest[]>;
waitForDecision(requestId, timeoutMs = 300_000): Promise<ApprovalRequest>;
```

### `AuditLog` (`src/safety/audit-log.ts`)

```ts
log(entry: Omit<AuditEntry,'id'|'timestamp'>): Promise<ResultOrError<void>>;
query(filters?: { agentId?; action?; outcome?; riskLevel?; since?; limit? }): Promise<AuditEntry[]>;
getRiskSummary(agentId?, since?): Promise<Record<'low'|'medium'|'high'|'critical', number>>;
getTopActions(agentId?, limit = 10): Promise<Array<{ action; count }>>;
```

---

## tools

### `Tool` (`src/tools/tool.ts`)

```ts
interface Tool<TInput = Record<string, unknown>, TOutput = ToolResult> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodSchema<TInput>;
  readonly permissions: ToolPermission[];
  readonly timeout?: number;
  execute(input: TInput): Promise<ResultOrError<TOutput>>;
  validate(input: unknown): ResultOrError<TInput>;
}
createTool<TInput, TOutput>(
  name: string,
  description: string,
  inputSchema: z.ZodSchema<TInput>,
  permissions: ToolPermission[],
  execute: (input: TInput) => Promise<ResultOrError<TOutput>>,
  options?: { timeout?: number }
): Tool<TInput, TOutput>;

interface ToolResult { success: boolean; output?: unknown; error?: string; metadata?: Record<string, unknown> }
interface ToolCall   { id: string; name: string; input: Record<string, unknown> }
interface ToolCallResult { callId; success; output?; error? }
type ToolPermission =
  | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.execute'
  | 'terminal.exec' | 'terminal.read'
  | 'git.read' | 'git.write' | 'git.push'
  | 'network.http' | 'network.websocket'
  | 'process.spawn';
```

### `ToolRegistry` (`src/tools/registry.ts`)

```ts
register(tool) / unregister(name): boolean;
get(name) / getAll() / getNames() / has(name)
grantPermission / revokePermission / hasPermission / grantAll(tool)
execute(call: ToolCall): Promise<ToolCallResult>;
executeBatch(calls: ToolCall[]): Promise<ToolCallResult[]>;
getToolSchemas(): Record<string, { name; description; parameters }>;   // for LLM tool declarations
```

### Built-in tools

| Module | Tools |
| --- | --- |
| `filesystem-tool` | `readFileTool`, `writeFileTool`, `listDirTool`, `deleteTool`, `statTool`, `copyTool` — all go through `safePath()` rooted at the project dir (⚠ BUG-009 prefix bypass reported) |
| `web-search-tool` | `webSearchTool`, `fetchUrlTool` |
| `code-analysis-tool` | `analyzeFileTool`, `findReferencesTool` (⚠ BUG-011/012 class-name detection reported) |
| terminal / git | ⏳ pending restore (`_excluded/terminal-tool.ts`, `_excluded/git-tool.ts`) |

---

## providers — `src/providers/model-provider.ts` (interface only)

```ts
interface ModelProvider {
  readonly name: string;
  readonly models: ModelInfo[];
  chat(options: ChatOptions): Promise<ResultOrError<ChatResponse>>;
  streamChat(options: ChatOptions): AsyncIterable<ResultOrError<StreamChunk>>;
  embed(options: EmbeddingOptions): Promise<ResultOrError<EmbeddingResponse>>;
  countTokens(model: string, text: string): Promise<ResultOrError<number>>;
  listModels(): Promise<ModelInfo[]>;
  healthCheck(): Promise<boolean>;
}
interface ProviderConfig { name; apiKey?; baseUrl?; organization?; defaultModel?; timeout?; maxRetries?; extraHeaders? }
```

Schemas exported: `MessageSchema`, `ToolSchema`, `ChatOptionsSchema`, `ChatResponseSchema`, `StreamChunkSchema`, `EmbeddingOptionsSchema`, `EmbeddingResponseSchema`, `ModelInfoSchema`, `MessageRoleSchema` (+ inferred types `Message`, `Tool`, `ChatOptions`, ...).

Concrete providers (OpenAI / Anthropic / Azure / local) and the factory: ⏳ pending restore (`_excluded/*-provider.ts`, `_excluded/factory.ts`, `_excluded/config.ts`).

---

## agents — `src/agents/interfaces/agent-interface.ts`

```ts
interface IAgent {
  readonly id; readonly name; readonly role: 'lead' | 'specialist'; readonly state: AgentState;
  initialize(config: AgentConfig): Promise<ResultOrError<void>>;
  startTask(context: TaskContext): Promise<ResultOrError<void>>;
  executeStep(step: PlanStep): Promise<ResultOrError<ExecutionResult>>;
  reflect(result: ExecutionResult): Promise<ResultOrError<ReflectionResult>>;
  handleError(error: Error, context): Promise<ResultOrError<void>>;
  sendMessage(message): Promise<ResultOrError<void>>;
  receiveMessage(message): Promise<ResultOrError<void>>;
  getState(): AgentState;
  shutdown(): Promise<void>;
}
interface IPlanner  { createPlan(ctx): Promise<ResultOrError<PlanResult>>; refinePlan(plan, feedback): ... }
interface IExecutor  { executeStep(step, ctx: AgentContext); callTool(tool, input); callModel(opts); streamModel(opts) }
interface IReflector { reflect(execution, ctx): Promise<ResultOrError<ReflectionResult>> }

interface AgentConfig { id; name; role; modelProvider; model; tools: Tool[]; messageBus; memory; systemPrompt; maxIterations; temperature }
interface AgentState  { id; status: 'idle'|'planning'|'acting'|'reflecting'|'blocked'|'error'|'completed'; currentTask?; iteration; context; history: AgentAction[] }
interface TaskContext { taskId; title; description; files[]; dependencies[]; priority: 'low'|'medium'|'high'|'critical'; context }
interface PlanResult  { steps: PlanStep[]; estimatedDuration; requiredTools[]; risks[] }
interface PlanStep    { id; description; tool?; input?; expectedOutput; dependencies[] }
interface ExecutionResult { success; output?; error?; actions: AgentAction[]; nextSteps? }
interface ReflectionResult { assessment: 'success'|'partial'|'failed'; lessons[]; improvements[]; nextActions[] }
interface AgentContext { task; state; config; memory; messageBus; tools: Map<string, Tool>; modelProvider }
```

`BaseAgent` / execution loop / lifecycle: ⏳ pending restore (`_excluded/base-agent.ts`, `execution-loop.ts`, `lifecycle.ts`, `error-handler.ts`, `agent-context.ts`).

---

## Package barrel — `src/index.ts`

Root exports (what `import { ... } from 'agent-platform'` resolves to): errors, result helpers, utils, obs (metrics/tracer/health), memory (all five components), tools (interface, registry, built-ins), providers (types), comm (bus/persistence/subscriptions/messages), tasks (registry/ownership/locks), safety (all four), agent interfaces.

> ⚠ `package.json` declares subpath exports (`./providers`, `./obs`, `./git`, `./agents`) for which no `index.ts` barrel exists yet — use the root import or deep paths until those barrels are added.
