import { Tool, ToolCall, ToolCallResult } from '@tools/tool.js';
import { ModelProvider, ChatOptions, ChatResponse, StreamChunk } from '@providers/model-provider.js';
import { MessageBus } from '@comm/message-bus.js';
import { MemoryStore } from '@memory/memory-store.js';
import { ResultOrError } from '@core/types.js';

export interface AgentConfig {
  id: string;
  name: string;
  role: 'lead' | 'specialist';
  modelProvider: ModelProvider;
  model: string;
  tools: Tool[];
  messageBus: MessageBus;
  memory: MemoryStore;
  systemPrompt: string;
  maxIterations: number;
  temperature: number;
}

export interface AgentState {
  id: string;
  status: 'idle' | 'planning' | 'acting' | 'reflecting' | 'blocked' | 'error' | 'completed';
  currentTask?: string;
  iteration: number;
  context: Record<string, unknown>;
  history: AgentAction[];
}

export interface AgentAction {
  type: 'plan' | 'tool_call' | 'tool_result' | 'reflect' | 'error' | 'message';
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface TaskContext {
  taskId: string;
  title: string;
  description: string;
  files: string[];
  dependencies: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  context: Record<string, unknown>;
}

export interface PlanResult {
  steps: PlanStep[];
  estimatedDuration: number;
  requiredTools: string[];
  risks: string[];
}

export interface PlanStep {
  id: string;
  description: string;
  tool?: string;
  input?: Record<string, unknown>;
  expectedOutput: string;
  dependencies: string[];
}

export interface ExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  actions: AgentAction[];
  nextSteps?: PlanStep[];
}

export interface ReflectionResult {
  assessment: 'success' | 'partial' | 'failed';
  lessons: string[];
  improvements: string[];
  nextActions: string[];
}

export interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly role: 'lead' | 'specialist';
  readonly state: AgentState;

  initialize(config: AgentConfig): Promise<ResultOrError<void>>;
  startTask(context: TaskContext): Promise<ResultOrError<void>>;
  executeStep(step: PlanStep): Promise<ResultOrError<ExecutionResult>>;
  reflect(result: ExecutionResult): Promise<ResultOrError<ReflectionResult>>;
  handleError(error: Error, context: Record<string, unknown>): Promise<ResultOrError<void>>;
  sendMessage(message: any): Promise<ResultOrError<void>>;
  receiveMessage(message: any): Promise<ResultOrError<void>>;
  getState(): AgentState;
  shutdown(): Promise<void>;
}

export interface IPlanner {
  createPlan(context: TaskContext): Promise<ResultOrError<PlanResult>>;
  refinePlan(plan: PlanResult, feedback: ReflectionResult): Promise<ResultOrError<PlanResult>>;
}

export interface IExecutor {
  executeStep(step: PlanStep, context: AgentContext): Promise<ResultOrError<ExecutionResult>>;
  callTool(tool: Tool, input: Record<string, unknown>): Promise<ResultOrError<ToolCallResult>>;
  callModel(options: ChatOptions): Promise<ResultOrError<ChatResponse>>;
  streamModel(options: ChatOptions): AsyncIterable<ResultOrError<StreamChunk>>;
}

export interface IReflector {
  reflect(execution: ExecutionResult, context: AgentContext): Promise<ResultOrError<ReflectionResult>>;
}

export interface AgentContext {
  task: TaskContext;
  state: AgentState;
  config: AgentConfig;
  memory: MemoryStore;
  messageBus: MessageBus;
  tools: Map<string, Tool>;
  modelProvider: ModelProvider;
}