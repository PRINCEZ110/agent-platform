import { ownershipRegistry } from '@tasks/ownership-registry.js';
import { taskRegistry } from '@tasks/task-registry.js';
import { HealthMonitor } from '@obs/health.js';
import { createMetrics } from '@obs/metrics.js';
import { InMemoryVectorStore } from '@memory/vector-store.js';

async function main(): Promise<void> {
  console.log('=== agent-platform demo (read-only) ===\n');

  console.log('[1] Ownership registry');
  const own = await ownershipRegistry.load();
  if (!own.ok) throw own.error;
  for (const file of ['src/core/types.ts', 'tests/comm/messages.test.ts', 'AGENTS.md', 'secrets.env']) {
    console.log(`    ${file} -> ${ownershipRegistry.getOwner(file)}`);
  }

  console.log('\n[2] Task registry');
  const tasks = await taskRegistry.load();
  if (!tasks.ok) throw tasks.error;
  const all = taskRegistry.getAllTasks();
  const byStatus = new Map<string, number>();
  for (const t of all) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
  console.log(`    ${all.length} tasks loaded`);
  for (const [status, count] of [...byStatus].sort()) console.log(`    ${status}: ${count}`);
  const mine = taskRegistry.getTasksByOwner('agent_b');
  console.log(`    agent_b owns: ${mine.map(t => t.task_id).join(', ')}`);

  console.log('\n[3] Health monitor');
  const monitor = new HealthMonitor();
  monitor.register({ name: 'database', critical: true, check: async () => ({ status: 'healthy' as const, timestamp: new Date() }) });
  monitor.register({ name: 'provider', critical: false, check: async () => ({ status: 'degraded' as const, message: 'no API key', timestamp: new Date() }) });
  const health = await monitor.runAllChecks();
  console.log(`    overall: ${health.status} (uptime ${health.uptime}ms)`);
  for (const [name, result] of Object.entries(health.checks)) console.log(`    ${name}: ${result.status}${result.message ? ` -- ${result.message}` : ''}`);
  monitor.shutdown();

  console.log('\n[4] Metrics exposition');
  const metrics = createMetrics({ defaultMetrics: false });
  const counter = metrics.counter('demo_events', 'Demo events');
  counter.inc();
  counter.inc();
  counter.inc();
  const exposition = await metrics.getMetrics();
  console.log(exposition.split('\n').slice(0, 4).map(l => `    ${l}`).join('\n'));

  console.log('\n[5] Vector store search');
  const store = new InMemoryVectorStore();
  await store.add({ id: '1', content: 'the agent platform uses message bus for comm', metadata: { topic: 'comm' } });
  await store.add({ id: '2', content: 'health monitor reports degraded provider', metadata: { topic: 'obs' } });
  await store.add({ id: '3', content: 'task registry tracks ownership', metadata: { topic: 'tasks' } });
  const hits = await store.search('message', 5);
  for (const hit of hits) console.log(`    score=${hit.score} [${hit.id}] ${hit.content}`);

  console.log('\n=== demo complete ===');
}

main().catch(err => {
  console.error('demo failed:', err);
  process.exitCode = 1;
});
