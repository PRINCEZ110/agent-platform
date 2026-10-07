import { AgentContext, AgentState, TaskContext, AgentConfig, PlanStep, ExecutionResult } from '@agents/interfaces/agent-interface.js';
import { Tool } from '@tools/tool.js';
import { ModelProvider } from '@providers/model-provider.js';
import { MessageBus } from '@comm/message-bus.js';
import { MemoryStore } from '@memory/memory-store.js';

export function createAgentContext(
  task: TaskContext,
  state: AgentState,
  config: AgentConfig,
  memory: MemoryStore,
  messageBus: MessageBus,
  tools: Tool[],
  modelProvider: ModelProvider
): AgentContext {
  return {
    task,
    state,
    config,
    memory,
    messageBus,
    tools: new Map(tools.map(t => [t.name, t])),
    modelProvider
  };
}

export function updateAgentContext(
  context: AgentContext,
  updates: Partial<Pick<AgentContext, 'task' | 'state' | 'config'>>
): AgentContext {
  return { ...context, ...updates };
}

export function createInitialState(agentId: string): AgentState {
  return {
    id: agentId,
    status: 'idle',
    iteration: 0,
    context: {},
    history: []
  };
}

export function createTaskContext(
  taskId: string,
  title: string,
  description: string,
  files: string[],
  dependencies: string[],
  priority: 'low' | 'medium' | 'high' | 'critical',
  context: Record<string, unknown>
): TaskContext {
  return { taskId, title, description, files, dependencies, priority, context };
}