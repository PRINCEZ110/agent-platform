import { BaseAgent } from './base-agent.js';
import { ExecutionResult, ReflectionResult } from '@agents/interfaces/agent-interface.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { AgentError } from '@core/errors.js';

export interface ErrorHandlerConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
  fatalErrors: string[];
}

export class ErrorHandler {
  private config: ErrorHandlerConfig;
  private retryCounts = new Map<string, number>();

  constructor(config: Partial<ErrorHandlerConfig> = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      fatalErrors: config.fatalErrors ?? ['QUOTA_EXCEEDED', 'UNAUTHORIZED', 'INVALID_API_KEY']
    };
  }

  async handle(agent: BaseAgent, error: Error, context: Record<string, unknown>): Promise<ResultOrError<void>> {
    const errorCode = (error as any).code ?? 'UNKNOWN_ERROR';

    if (this.config.fatalErrors.includes(errorCode)) {
      return err(new AgentError(`Fatal error: ${error.message}`, errorCode, error));
    }

    const key = `${errorCode}:${JSON.stringify(context)}`;
    const retries = this.retryCounts.get(key) ?? 0;

    if (retries >= this.config.maxRetries) {
      this.retryCounts.delete(key);
      return err(new AgentError(`Max retries exceeded for ${errorCode}`, 'MAX_RETRIES', error));
    }

    this.retryCounts.set(key, retries + 1);

    const delay = this.config.retryDelay * Math.pow(this.config.backoffMultiplier, retries);
    await new Promise(resolve => setTimeout(resolve, delay));

    return ok(undefined);
  }

  async handleExecutionError(
    agent: BaseAgent,
    result: ExecutionResult,
    context: Record<string, unknown>
  ): Promise<ResultOrError<ExecutionResult>> {
    if (result.success) return ok(result);

    const error = new Error(result.error ?? 'Execution failed');
    const handled = await this.handle(agent, error, context);

    if (!handled.ok) {
      return err(handled.error);
    }

    // Retry the step
    return ok({ ...result, success: false, error: `Retrying after error: ${error.message}` });
  }

  async handleReflectionError(
    agent: BaseAgent,
    reflection: ReflectionResult,
    context: Record<string, unknown>
  ): Promise<ResultOrError<ReflectionResult>> {
    if (reflection.assessment !== 'failed') return ok(reflection);

    const error = new Error(`Reflection indicates failure: ${reflection.lessons.join(', ')}`);
    const handled = await this.handle(agent, error, context);

    if (!handled.ok) {
      return err(handled.error);
    }

    return ok({ ...reflection, assessment: 'partial', improvements: [...reflection.improvements, 'Retry after error handling'] });
  }

  resetRetryCount(errorCode: string, context: Record<string, unknown>): void {
    const key = `${errorCode}:${JSON.stringify(context)}`;
    this.retryCounts.delete(key);
  }

  getRetryCount(errorCode: string, context: Record<string, unknown>): number {
    const key = `${errorCode}:${JSON.stringify(context)}`;
    return this.retryCounts.get(key) ?? 0;
  }
}

export function createErrorHandler(config?: Partial<ErrorHandlerConfig>): ErrorHandler {
  return new ErrorHandler(config);
}