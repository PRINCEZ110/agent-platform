import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentTracer, createTracer } from '../../src/obs/tracer.js';

describe('AgentTracer', () => {
  let tracer: AgentTracer;

  beforeAll(() => {
    tracer = createTracer({ serviceName: 'tracer-test' });
  });

  afterAll(async () => {
    await tracer.shutdown();
  });

  it('exposes an OpenTelemetry tracer', () => {
    expect(tracer.getTracer()).toBeDefined();
  });

  it('traceSync returns the wrapped value', () => {
    const result = tracer.traceSync('compute', span => {
      expect(span).toBeDefined();
      return 42;
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('traceSync swallows thrown errors and resolves ok(null) (documented behavior)', () => {
    const result = tracer.traceSync('boom', () => {
      throw new Error('sync failure');
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it('traceAsync returns the resolved value', async () => {
    const result = await tracer.traceAsync('async-work', async span => {
      expect(span).toBeDefined();
      return 'done';
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('done');
  });

  it('traceAsync swallows rejected promises (documented behavior)', async () => {
    const result = await tracer.traceAsync('async-boom', async () => {
      throw new Error('async failure');
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it('makes the active span visible while a trace is running', async () => {
    expect(tracer.getCurrentSpan()).toBeUndefined();
    await tracer.traceAsync('active-span', async () => {
      expect(tracer.getCurrentSpan()).toBeDefined();
      tracer.setSpanAttribute('agent.id', 'agent_b');
      tracer.addEvent('checkpoint');
    });
    expect(tracer.getCurrentSpan()).toBeUndefined();
  });

  it('attribute helpers are no-ops outside a span instead of throwing', () => {
    expect(() => tracer.setSpanAttribute('k', 'v')).not.toThrow();
    expect(() => tracer.addEvent('e')).not.toThrow();
  });

  it('startSpan returns a usable span and can be ended', () => {
    const span = tracer.startSpan('manual', { attributes: { 'task.id': 'TASK-017' } });
    expect(span).toBeDefined();
    expect(typeof span.end).toBe('function');
    span.end();
  });

  it('shutdown resolves', async () => {
    const other = createTracer({ serviceName: 'shutdown-test' });
    await expect(other.shutdown()).resolves.toBeUndefined();
  });
});
