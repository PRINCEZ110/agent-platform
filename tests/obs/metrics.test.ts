import { describe, it, expect } from 'vitest';
import { AgentMetrics, createMetrics } from '../../src/obs/metrics.js';

describe('AgentMetrics', () => {
  it('creates an isolated registry per instance', () => {
    const a = createMetrics({ defaultMetrics: false });
    const b = createMetrics({ defaultMetrics: false });
    expect(a.getRegistry()).not.toBe(b.getRegistry());
  });

  it('returns the same counter instance for repeated calls', () => {
    const metrics = createMetrics({ defaultMetrics: false });
    const first = metrics.counter('events', 'event count');
    const second = metrics.counter('events', 'event count');
    expect(first).toBe(second);
  });

  it('applies the configured prefix to metric names', async () => {
    const metrics = createMetrics({ prefix: 'my_', defaultMetrics: false });
    metrics.counter('events', 'event count').inc();
    const output = await metrics.getMetrics();
    expect(output).toContain('my_events');
    expect(output).not.toContain('agent_events');
  });

  it('increments counters and exposes them in the exposition output', async () => {
    const metrics = createMetrics({ defaultMetrics: false });
    const counter = metrics.counter('events', 'event count');
    counter.inc();
    counter.inc();
    counter.inc();

    const output = await metrics.getMetrics();
    expect(output).toMatch(/^agent_events(?:_total)? 3$/m);
  });

  it('sets gauges', async () => {
    const metrics = createMetrics({ defaultMetrics: false });
    metrics.gauge('queue_depth', 'queue depth').set(7);
    const output = await metrics.getMetrics();
    expect(output).toMatch(/^agent_queue_depth 7$/m);
  });

  it('observes histogram values into buckets', async () => {
    const metrics = createMetrics({ defaultMetrics: false });
    metrics.histogram('latency_seconds', 'latency', [], [0.1, 0.5, 1]).observe(0.25);
    const output = await metrics.getMetrics();
    expect(output).toContain('agent_latency_seconds_bucket');
    expect(output).toContain('agent_latency_seconds_count');
  });

  it.fails('BUG-004: convenience helpers crash (empty help / undefined buckets passed to prom-client)', () => {
    const metrics = createMetrics({ defaultMetrics: false });
    metrics.incCounter('events');
    metrics.setGauge('queue_depth', 1);
    metrics.observeHistogram('latency', 0.1);
    metrics.histogram('broken_histogram', 'help without buckets');
  });

  it('registers default runtime metrics unless disabled', async () => {
    const withDefaults = new AgentMetrics({ defaultMetrics: true });
    const without = createMetrics({ defaultMetrics: false });

    expect(await withDefaults.getMetrics()).toContain('process_cpu');
    expect(await without.getMetrics()).not.toContain('process_cpu');
  });

  it('exposes a content type for scraping', async () => {
    const metrics = createMetrics({ defaultMetrics: false });
    expect(await metrics.getContentType()).toContain('text/plain');
  });

  it('lazily creates the predefined metrics with label dimensions', async () => {
    const metrics = createMetrics({ defaultMetrics: false });

    expect(metrics.toolCalls).toBe(metrics.toolCalls);
    metrics.toolCalls.inc({ tool: 'terminal', agent: 'agent_b', outcome: 'ok' });
    metrics.errors.inc({ agent: 'agent_b', type: 'timeout', component: 'tool' });
    metrics.activeAgents.set({ agent: 'agent_b' }, 2);
    metrics.toolDuration.observe({ tool: 'terminal', agent: 'agent_b' }, 0.4);
    metrics.modelCalls.inc({ provider: 'openai', model: 'gpt', agent: 'agent_a', outcome: 'ok' });
    metrics.modelTokens.inc({ provider: 'openai', model: 'gpt', agent: 'agent_a', type: 'prompt' }, 100);
    metrics.modelDuration.observe({ provider: 'openai', model: 'gpt', agent: 'agent_a' }, 1.5);
    metrics.taskDuration.observe({ agent: 'agent_b', task_type: 'test', outcome: 'ok' }, 12);

    const output = await metrics.getMetrics();
    expect(output).toContain('agent_tool_calls');
    expect(output).toContain('agent_errors');
    expect(output).toContain('agent_active_agents');
    expect(output).toContain('agent_tool_duration');
    expect(output).toContain('agent_model_calls');
    expect(output).toContain('agent_model_tokens');
    expect(output).toContain('agent_model_duration');
    expect(output).toContain('agent_task_duration');
  });

  it('predefined getters are stable across accesses', () => {
    const metrics = createMetrics({ defaultMetrics: false });
    expect(metrics.modelCalls).toBe(metrics.modelCalls);
    expect(metrics.taskDuration).toBe(metrics.taskDuration);
    expect(metrics.modelTokens).toBe(metrics.modelTokens);
    expect(metrics.modelDuration).toBe(metrics.modelDuration);
  });
});
