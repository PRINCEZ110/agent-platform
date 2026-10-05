# Examples

Runnable, side-effect-free examples for the agent platform. They import source directly via the same path aliases the platform uses (`@comm/*`, `@memory/*`, ...), so no build is required.

## Run

```bash
npx tsx docs/examples/health-metrics.ts
npx tsx docs/examples/tools.ts
npx tsx docs/examples/messages.ts
npx tsx docs/examples/codebase-search.ts
```

| Example | Shows |
| --- | --- |
| `health-metrics.ts` | Registering health checks, aggregating `HealthStatus`, Prometheus exposition via `AgentMetrics` |
| `tools.ts` | Defining a tool with `createTool`, registering it, executing through `ToolRegistry` with permission enforcement |
| `messages.ts` | Building typed messages with the factories, filtering them with `SubscriptionManager` (no disk writes) |
| `codebase-search.ts` | Indexing this repo with `CodebaseIndexer` into `InMemoryVectorStore` and running semantic-ish search |

## Constraints

- Examples are **read-only**: they never write to `.ai/`, never publish on `MessageBus` (which would persist), and never call LLM providers.
- `MemoryStore` / `DecisionLog` / `MessageBus` persistence examples are intentionally omitted — those write to the control center; see `tests/**` for mocked-fs patterns instead.
