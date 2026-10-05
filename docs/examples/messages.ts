import {
  createTaskAssign,
  createStatusUpdate,
  createEscalation,
} from '@comm/messages.js';
import { SubscriptionManager } from '@comm/subscription.js';

async function main(): Promise<void> {
  const assignment = createTaskAssign('agent_a', 'agent_b', {
    taskId: 'TASK-019',
    description: 'Write platform documentation',
    files: ['docs/architecture.md'],
    priority: 'medium',
  });
  console.log('task_assign message:', assignment.type, '->', assignment.to, assignment.payload.taskId);

  const status = createStatusUpdate('agent_b', {
    taskId: 'TASK-019',
    status: 'IN_PROGRESS',
    message: 'writing docs',
  });
  const escalation = createEscalation('agent_b', 'agent_a', {
    taskId: 'TASK-012',
    reason: 'BaseAgent still excluded',
    severity: 'high',
  });

  const manager = new SubscriptionManager();
  manager.subscribe('agent_b-inbox', { types: ['task_assign', 'escalation'], to: 'agent_b' }, m => {
    console.log(`  [agent_b inbox] ${m.type} from ${m.from}`);
  });
  manager.subscribe('all-audit', { from: 'agent_b' }, m => {
    console.log(`  [audit] agent_b sent ${m.type}`);
  });

  console.log('\npublishing three messages:');
  manager.notify(assignment);
  manager.notify(status);
  manager.notify(escalation);

  console.log('\nsubscription ids:', manager.getSubscriptionIds());
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
