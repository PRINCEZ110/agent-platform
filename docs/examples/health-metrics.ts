import { HealthMonitor } from '@obs/health.js';
import { createMetrics } from '@obs/metrics.js';

async function main(): Promise<void> {
  console.log('=== health checks ===\n');

  const health = new HealthMonitor();
  health.register({
    name: 'memory',
    critical: false,
    check: async () => ({ status: 'healthy', message: 'in-memory store ok', timestamp: new Date() }),
  });
  health.register({
    name: 'vector-search',
    critical: true,
    check: async () => ({ status: 'healthy', details: { backend: 'in-memory' }, timestamp: new Date() }),
  });
  health.register({
    name: 'example-degraded',
    critical: false,
    check: async () => ({ status: 'degraded', message: 'simulated latency', timestamp: new Date() }),
  });

  const status = await health.getHealth();
  console.log(`overall: ${status.status} (uptime ${Math.round(status.uptime)}ms)`);
  for (const [name, result] of Object.entries(status.checks)) {
    console.log(`  ${name}: ${result.status}${result.message ? ` -- ${result.message}` : ''}`);
  }

  console.log('\n=== metrics exposition ===\n');

  const metrics = createMetrics({ defaultMetrics: false });

  // Declare metrics explicitly with non-empty help strings (the incCounter/setGauge
  // shorthands currently register with empty help -- see BUG-004 -- so prefer the
  // counter()/gauge()/histogram() constructors).
  const ops = metrics.counter('example_ops_total', 'Demo operations', ['tool']);
  ops.inc({ tool: 'read_file' });
  ops.inc({ tool: 'read_file' });
  ops.inc({ tool: 'analyze' });

  const active = metrics.gauge('example_active_agents', 'Active demo agents', ['role']);
  active.set({ role: 'specialist' }, 2);

  const text = await metrics.getMetrics();
  const relevant = text
    .split('\n')
    .filter(l => l.includes('example_') && !l.startsWith('#'))
    .join('\n');
  console.log(relevant);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
