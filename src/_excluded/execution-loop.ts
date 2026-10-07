import { BaseAgent } from './base-agent.js';
import { PlanStep, ExecutionResult, PlanResult, TaskContext } from '@agents/interfaces/agent-interface.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { AgentError } from '@core/errors.js';

export class ExecutionLoop {
  private agent: BaseAgent;
  private maxIterations: number;
  private currentPlan: PlanResult | null = null;
  private completedSteps = new Set<string>();

  constructor(agent: BaseAgent, maxIterations: number) {
    this.agent = agent;
    this.maxIterations = maxIterations;
  }

  async run(taskContext: TaskContext): Promise<ResultOrError<ExecutionResult>> {
    const startResult = await this.agent.startTask(taskContext);
    if (!startResult.ok) return startResult;

    const planResult = await this.agent['planner'].createPlan(taskContext);
    if (!planResult.ok) return planResult;

    this.currentPlan = planResult.value;
    this.completedSteps.clear();

    let overallSuccess = true;
    const allActions: ExecutionResult['actions'] = [];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const nextStep = this.getNextStep();
      if (!nextStep) break;

      const result = await this.agent.executeStep(nextStep);
      allActions.push(...(result.ok ? result.value.actions : []));

      if (!result.ok) {
        overallSuccess = false;
        const reflection = await this.agent.reflect({ success: false, error: result.error.message, actions: [] });
        if (!reflection.ok || reflection.value.assessment === 'failed') {
          break;
        }
        // Try to refine plan
        if (reflection.value.nextActions.length > 0) {
          const refined = await this.agent['planner'].refinePlan(this.currentPlan!, reflection.value);
          if (refined.ok) this.currentPlan = refined.value;
        }
        continue;
      }

      this.completedSteps.add(nextStep.id);

      const reflection = await this.agent.reflect(result.value);
      if (!reflection.ok) continue;

      if (reflection.value.assessment === 'failed') {
        overallSuccess = false;
        break;
      }

      if (reflection.value.nextActions.length > 0) {
        const refined = await this.agent['planner'].refinePlan(this.currentPlan!, reflection.value);
        if (refined.ok) this.currentPlan = refined.value;
      }
    }

    const finalReflection = await this.agent.reflect({
      success: overallSuccess,
      actions: allActions,
      nextSteps: this.currentPlan?.steps.filter(s => !this.completedSteps.has(s.id))
    });

    return ok({
      success: overallSuccess,
      output: finalReflection.ok ? finalReflection.value : undefined,
      actions: allActions,
      nextSteps: this.currentPlan?.steps.filter(s => !this.completedSteps.has(s.id))
    });
  }

  private getNextStep(): PlanStep | undefined {
    if (!this.currentPlan) return undefined;
    return this.currentPlan.steps.find(s =>
      !this.completedSteps.has(s.id) &&
      s.dependencies.every(d => this.completedSteps.has(d))
    );
  }

  async executeSingleStep(step: PlanStep): Promise<ResultOrError<ExecutionResult>> {
    return this.agent.executeStep(step);
  }
}

export function createExecutionLoop(agent: BaseAgent, maxIterations: number): ExecutionLoop {
  return new ExecutionLoop(agent, maxIterations);
}