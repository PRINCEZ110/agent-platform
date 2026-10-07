import { Orchestrator } from './orchestrator.js';
import { ResultOrError, ok } from '@core/types.js';

export async function bootstrap(): Promise<ResultOrError<Orchestrator>> {
  const orchestrator = new Orchestrator();
  const initResult = await orchestrator.initialize();
  if (!initResult.ok) return initResult;

  const startResult = await orchestrator.start();
  if (!startResult.ok) return startResult;

  return ok(orchestrator);
}

export async function shutdown(orchestrator: Orchestrator): Promise<void> {
  await orchestrator.stop();
}