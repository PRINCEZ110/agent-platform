import { BaseAgent } from './base-agent.js';
import { AgentConfig, AgentState, TaskContext } from '@agents/interfaces/agent-interface.js';
import { ResultOrError, ok } from '@core/types.js';

export interface LifecycleHooks {
  onInitialize?: (agent: BaseAgent, config: AgentConfig) => Promise<void>;
  onTaskStart?: (agent: BaseAgent, task: TaskContext) => Promise<void>;
  onStepStart?: (agent: BaseAgent, step: any) => Promise<void>;
  onStepComplete?: (agent: BaseAgent, step: any, result: any) => Promise<void>;
  onReflection?: (agent: BaseAgent, reflection: any) => Promise<void>;
  onError?: (agent: BaseAgent, error: Error, context: Record<string, unknown>) => Promise<void>;
  onMessage?: (agent: BaseAgent, message: any) => Promise<void>;
  onShutdown?: (agent: BaseAgent) => Promise<void>;
}

export class AgentLifecycle {
  private hooks: LifecycleHooks;
  private initialized = false;
  private running = false;

  constructor(hooks: LifecycleHooks = {}) {
    this.hooks = hooks;
  }

  async initialize(agent: BaseAgent, config: AgentConfig): Promise<ResultOrError<void>> {
    if (this.initialized) return ok(undefined);

    try {
      if (this.hooks.onInitialize) {
        await this.hooks.onInitialize(agent, config);
      }
      this.initialized = true;
      return ok(undefined);
    } catch (e) {
      return ok(undefined); // Non-blocking
    }
  }

  async startTask(agent: BaseAgent, task: TaskContext): Promise<void> {
    this.running = true;
    if (this.hooks.onTaskStart) {
      await this.hooks.onTaskStart(agent, task).catch(console.error);
    }
  }

  async startStep(agent: BaseAgent, step: any): Promise<void> {
    if (this.hooks.onStepStart) {
      await this.hooks.onStepStart(agent, step).catch(console.error);
    }
  }

  async completeStep(agent: BaseAgent, step: any, result: any): Promise<void> {
    if (this.hooks.onStepComplete) {
      await this.hooks.onStepComplete(agent, step, result).catch(console.error);
    }
  }

  async reflect(agent: BaseAgent, reflection: any): Promise<void> {
    if (this.hooks.onReflection) {
      await this.hooks.onReflection(agent, reflection).catch(console.error);
    }
  }

  async error(agent: BaseAgent, error: Error, context: Record<string, unknown>): Promise<void> {
    if (this.hooks.onError) {
      await this.hooks.onError(agent, error, context).catch(console.error);
    }
  }

  async message(agent: BaseAgent, message: any): Promise<void> {
    if (this.hooks.onMessage) {
      await this.hooks.onMessage(agent, message).catch(console.error);
    }
  }

  async shutdown(agent: BaseAgent): Promise<void> {
    this.running = false;
    if (this.hooks.onShutdown) {
      await this.hooks.onShutdown(agent).catch(console.error);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isRunning(): boolean {
    return this.running;
  }

  setHooks(hooks: Partial<LifecycleHooks>): void {
    this.hooks = { ...this.hooks, ...hooks };
  }
}

export function createAgentLifecycle(hooks?: LifecycleHooks): AgentLifecycle {
  return new AgentLifecycle(hooks);
}