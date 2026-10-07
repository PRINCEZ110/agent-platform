import { IAgent, AgentConfig, AgentState, AgentAction, TaskContext, PlanResult, PlanStep, ExecutionResult, ReflectionResult, AgentContext, IPlanner, IExecutor, IReflector } from '@agents/interfaces/agent-interface.js';
import { Tool, ToolCallResult } from '@tools/tool.js';
import { ModelProvider, ChatOptions, ChatResponse, StreamChunk, Message } from '@providers/model-provider.js';
import { MessageBus } from '@comm/message-bus.js';
import { MemoryStore } from '@memory/memory-store.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { AgentError } from '@core/errors.js';

export abstract class BaseAgent implements IAgent {
  readonly id: string;
  readonly name: string;
  readonly role: 'lead' | 'specialist';
  readonly state: AgentState;

  protected config!: AgentConfig;
  protected planner!: IPlanner;
  protected executor!: IExecutor;
  protected reflector!: IReflector;
  protected context!: AgentContext;

  constructor(id: string, name: string, role: 'lead' | 'specialist') {
    this.id = id;
    this.name = name;
    this.role = role;
    this.state = {
      id,
      status: 'idle',
      iteration: 0,
      context: {},
      history: []
    };
  }

  async initialize(config: AgentConfig): Promise<ResultOrError<void>> {
    this.config = config;
    this.planner = this.createPlanner();
    this.executor = this.createExecutor();
    this.reflector = this.createReflector();

    this.context = {
      task: {} as TaskContext,
      state: this.state,
      config,
      memory: config.memory,
      messageBus: config.messageBus,
      tools: new Map(config.tools.map(t => [t.name, t])),
      modelProvider: config.modelProvider
    };

    this.state.status = 'idle';
    return ok(undefined);
  }

  protected abstract createPlanner(): IPlanner;
  protected abstract createExecutor(): IExecutor;
  protected abstract createReflector(): IReflector;

  async startTask(context: TaskContext): Promise<ResultOrError<void>> {
    this.state.status = 'planning';
    this.state.currentTask = context.taskId;
    this.state.iteration = 0;
    this.state.context = context.context;
    this.context.task = context;
    this.state.status = 'acting';
    return ok(undefined);
  }

  async executeStep(step: PlanStep): Promise<ResultOrError<ExecutionResult>> {
    this.state.iteration++;
    this.addAction({ type: 'plan', timestamp: new Date(), data: { step } });

    const result = await this.executor.executeStep(step, this.context);

    if (result.ok) {
      this.addAction({ type: 'tool_result', timestamp: new Date(), data: { stepId: step.id, output: result.value.output } });
    } else {
      this.addAction({ type: 'error', timestamp: new Date(), data: { stepId: step.id, error: result.error.message } });
      await this.handleError(new Error(result.error.message), { step });
    }

    return result;
  }

  async reflect(result: ExecutionResult): Promise<ResultOrError<ReflectionResult>> {
    this.state.status = 'reflecting';
    this.addAction({ type: 'reflect', timestamp: new Date(), data: { iteration: this.state.iteration } });

    const reflection = await this.reflector.reflect(result, this.context);

    if (reflection.ok) {
      this.addAction({ type: 'reflect', timestamp: new Date(), data: reflection.value as unknown as Record<string, unknown> });
    }

    return reflection;
  }

  async handleError(error: Error, context: Record<string, unknown>): Promise<ResultOrError<void>> {
    this.state.status = 'error';
    this.addAction({ type: 'error', timestamp: new Date(), data: { error: error.message, context } });
    return ok(undefined);
  }

  async sendMessage(message: unknown): Promise<ResultOrError<void>> {
    return this.config.messageBus.publish(message as any);
  }

  async receiveMessage(message: unknown): Promise<ResultOrError<void>> {
    this.addAction({ type: 'message', timestamp: new Date(), data: message });
    return this.handleMessage(message);
  }

  protected abstract handleMessage(message: unknown): Promise<ResultOrError<void>>;

  getState(): AgentState {
    return { ...this.state };
  }

  async shutdown(): Promise<void> {
    this.state.status = 'idle';
    this.state.currentTask = undefined;
  }

  protected addAction(action: AgentAction): void {
    this.state.history.push(action);
    if (this.state.history.length > 100) {
      this.state.history.shift();
    }
  }

  protected async callModel(options: ChatOptions): Promise<ResultOrError<ChatResponse>> {
    return this.config.modelProvider.chat({ ...options, model: this.config.model });
  }

  protected async streamModel(options: ChatOptions): AsyncIterable<ResultOrError<StreamChunk>> {
    for await (const chunk of this.config.modelProvider.streamChat({ ...options, model: this.config.model })) {
      yield chunk;
    }
  }

  protected async callTool(name: string, input: Record<string, unknown>): Promise<ResultOrError<ToolCallResult>> {
    const tool = this.context.tools.get(name);
    if (!tool) return err(new AgentError(`Tool not found: ${name}`, 'TOOL_NOT_FOUND'));
    return tool.execute(input);
  }

  protected async storeMemory(key: string, value: unknown): Promise<void> {
    await this.context.memory.set(key, value);
  }

  protected async retrieveMemory(key: string): Promise<unknown> {
    return this.context.memory.get(key);
  }

  protected async searchMemory(query: string, limit = 10): Promise<unknown[]> {
    return this.context.memory.search(query, limit);
  }
}