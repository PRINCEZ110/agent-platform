// Minimal exports for working modules only
export { AgentError, ProviderError, ToolError, GitError, CommunicationError, MemoryError, TaskError, SafetyError, ValidationError, AppError } from '@core/errors.js';
export { ok, err, isOk, isErr } from '@core/types.js';
export type { ResultOrError } from '@core/types.js';
export { generateId, sleep, retry, timeout, sanitizePath, truncate, deepClone, isRecord } from '@core/utils.js';

export { AgentMetrics, createMetrics, defaultMetrics } from '@obs/metrics.js';
export { AgentTracer, createTracer, defaultTracer } from '@obs/tracer.js';
export { HealthMonitor, createHealthMonitor, healthMonitor } from '@obs/health.js';
export type { HealthCheck, HealthCheckResult, HealthStatus } from '@obs/health.js';

export { MemoryStore, createMemoryStore } from '@memory/memory-store.js';
export { InMemoryVectorStore, EmbeddingVectorStore, createVectorStore } from '@memory/vector-store.js';
export type { VectorStore, VectorDocument, VectorSearchResult } from '@memory/vector-store.js';
export { CodebaseIndexer, createCodebaseIndexer } from '@memory/codebase-indexer.js';
export type { CodebaseIndexConfig, DEFAULT_INDEX_CONFIG } from '@memory/codebase-indexer.js';
export { DecisionLog, createDecisionLog } from '@memory/decision-log.js';
export type { DecisionEntry } from '@memory/decision-log.js';
export { ContextBuilder, createContextBuilder } from '@memory/context-builder.js';
export type { ContextBundle } from '@memory/context-builder.js';

export { createTool } from '@tools/tool.js';
export type { Tool, ToolPermission, ToolResult, ToolCall, ToolCallResult } from '@tools/tool.js';
export { ToolRegistry, toolRegistry } from '@tools/registry.js';
export { readFileTool, writeFileTool, listDirTool, deleteTool, statTool, copyTool } from '@tools/filesystem-tool.js';
export { webSearchTool, fetchUrlTool } from '@tools/web-search-tool.js';
export { analyzeFileTool, findReferencesTool } from '@tools/code-analysis-tool.js';

export type { ModelProvider } from '@providers/model-provider.js';
export type { Message, Tool as ProviderTool, ChatOptions, ChatResponse, StreamChunk, EmbeddingOptions, EmbeddingResponse, ModelInfo, ProviderConfig } from '@providers/model-provider.js';

export { MessageBus, createMessageBus } from '@comm/message-bus.js';
export { persistence } from '@comm/persistence.js';
export { SubscriptionManager, subscriptionManager } from '@comm/subscription.js';
export type { MessageType, TaskAssignPayload, StatusUpdatePayload, ReviewRequestPayload, ContextHandoffPayload, EscalationPayload, AcknowledgmentPayload, HeartbeatPayload, createTaskAssign, createStatusUpdate, createReviewRequest, createContextHandoff, createEscalation, createAcknowledgment, createHeartbeat, SubscriptionFilter } from '@comm/messages.js';

export { OwnershipRegistry, ownershipRegistry } from '@tasks/ownership-registry.js';
export type { OwnershipConfig } from '@tasks/ownership-registry.js';
export { TaskRegistry, taskRegistry } from '@tasks/task-registry.js';
export type { Task } from '@tasks/task-registry.js';
export { FileLockManager, fileLockManager } from '@tasks/file-lock-manager.js';
export type { FileLock } from '@tasks/file-lock-manager.js';

export { PermissionsManager, permissionsManager } from '@safety/permissions.js';
export type { PermissionSet, DEFAULT_PERMISSIONS } from '@safety/permissions.js';
export { PermissionChecker, permissionChecker } from '@safety/checker.js';
export { ApprovalGate, approvalGate } from '@safety/approval-gate.js';
export type { ApprovalRequest } from '@safety/approval-gate.js';
export { AuditLog, auditLog } from '@safety/audit-log.js';
export type { AuditEntry } from '@safety/audit-log.js';

export type { IAgent, AgentConfig, AgentState, AgentAction, TaskContext, PlanResult, PlanStep, ExecutionResult, ReflectionResult, IPlanner, IExecutor, IReflector, AgentContext } from '@agents/interfaces/agent-interface.js';