import { Command } from 'commander';
import { ownershipRegistry } from './ownership-registry.js';
import { taskRegistry } from './task-registry.js';
import { fileLockManager } from './file-lock-manager.js';
import { ResultOrError, ok, err } from '@core/types.js';

export async function createTasksCLI(): Promise<Command> {
  const program = new Command();

  program
    .name('agent-tasks')
    .description('Task ownership and coordination CLI')
    .version('0.1.0');

  program
    .command('claim <taskId>')
    .description('Claim a task for the current agent')
    .option('-a, --agent <agent>', 'Agent ID (agent_a or agent_b)', 'agent_a')
    .action(async (taskId, options) => {
      await taskRegistry.load();
      const result = await taskRegistry.updateTask(taskId, { status: 'IN_PROGRESS' });
      if (!result.ok) {
        console.error(`Failed to claim task: ${result.error.message}`);
        process.exit(1);
      }
      console.log(`Task ${taskId} claimed by ${options.agent}`);
    });

  program
    .command('release <taskId>')
    .description('Release a claimed task')
    .option('-a, --agent <agent>', 'Agent ID (agent_a or agent_b)', 'agent_a')
    .action(async (taskId, options) => {
      await taskRegistry.load();
      const result = await taskRegistry.updateTask(taskId, { status: 'READY' });
      if (!result.ok) {
        console.error(`Failed to release task: ${result.error.message}`);
        process.exit(1);
      }
      console.log(`Task ${taskId} released by ${options.agent}`);
    });

  program
    .command('complete <taskId>')
    .description('Mark a task as completed')
    .option('-a, --agent <agent>', 'Agent ID (agent_a or agent_b)', 'agent_a')
    .action(async (taskId, options) => {
      await taskRegistry.load();
      const result = await taskRegistry.updateTask(taskId, { status: 'COMPLETED' });
      if (!result.ok) {
        console.error(`Failed to complete task: ${result.error.message}`);
        process.exit(1);
      }
      console.log(`Task ${taskId} completed by ${options.agent}`);
    });

  program
    .command('status <taskId>')
    .description('Get task status')
    .action(async (taskId) => {
      await taskRegistry.load();
      const task = taskRegistry.getTask(taskId);
      if (!task) {
        console.error(`Task not found: ${taskId}`);
        process.exit(1);
      }
      console.log(JSON.stringify(task, null, 2));
    });

  program
    .command('list')
    .description('List all tasks')
    .option('-o, --owner <agent>', 'Filter by owner')
    .option('-s, --status <status>', 'Filter by status')
    .action(async (options) => {
      await taskRegistry.load();
      let tasks = taskRegistry.getAllTasks();
      if (options.owner) tasks = tasks.filter(t => t.owner === options.owner);
      if (options.status) tasks = tasks.filter(t => t.status === options.status);
      console.table(tasks.map(t => ({
        id: t.task_id,
        owner: t.owner,
        status: t.status,
        description: t.description.substring(0, 60)
      })));
    });

  program
    .command('ready')
    .description('List tasks ready to start')
    .option('-a, --agent <agent>', 'Filter by agent', 'agent_a')
    .action(async (options) => {
      await taskRegistry.load();
      const tasks = taskRegistry.getReadyTasks(options.agent as 'agent_a' | 'agent_b');
      console.table(tasks.map(t => ({
        id: t.task_id,
        owner: t.owner,
        status: t.status,
        description: t.description.substring(0, 60)
      })));
    });

  program
    .command('check-ownership <file>')
    .description('Check file ownership')
    .action(async (file) => {
      await ownershipRegistry.load();
      const owner = ownershipRegistry.getOwner(file);
      console.log(`${file} -> ${owner}`);
    });

  program
    .command('validate-access <files...>')
    .description('Validate agent access to files')
    .requiredOption('-a, --agent <agent>', 'Agent ID (agent_a or agent_b)')
    .action(async (files, options) => {
      await ownershipRegistry.load();
      const { allowed, denied } = ownershipRegistry.validateFileAccess(options.agent as 'agent_a' | 'agent_b', files);
      console.log('Allowed:', allowed);
      console.log('Denied:', denied);
      if (denied.length > 0) process.exit(1);
    });

  program
    .command('lock <file>')
    .description('Acquire a file lock')
    .requiredOption('-t, --task <taskId>', 'Task ID')
    .requiredOption('-a, --agent <agent>', 'Agent ID (agent_a or agent_b)')
    .option('--ttl <ms>', 'Time to live in ms', '3600000')
    .action(async (file, options) => {
      await fileLockManager.initialize();
      const result = await fileLockManager.acquire(file, options.task, options.agent as 'agent_a' | 'agent_b', parseInt(options.ttl));
      if (!result.ok) {
        console.error(`Failed to acquire lock: ${result.error.message}`);
        process.exit(1);
      }
      console.log(`Lock acquired for ${file} by ${options.agent} (task: ${options.task})`);
    });

  program
    .command('unlock <file>')
    .description('Release a file lock')
    .requiredOption('-t, --task <taskId>', 'Task ID')
    .requiredOption('-a, --agent <agent>', 'Agent ID (agent_a or agent_b)')
    .action(async (file, options) => {
      await fileLockManager.initialize();
      const result = await fileLockManager.release(file, options.task, options.agent as 'agent_a' | 'agent_b');
      if (!result.ok) {
        console.error(`Failed to release lock: ${result.error.message}`);
        process.exit(1);
      }
      console.log(`Lock released for ${file} by ${options.agent} (task: ${options.task})`);
    });

  program
    .command('locks')
    .description('List active locks')
    .option('-a, --agent <agent>', 'Filter by agent')
    .option('-t, --task <taskId>', 'Filter by task')
    .action(async (options) => {
      await fileLockManager.initialize();
      let locks = Array.from((fileLockManager as any).locks.values());
      if (options.agent) locks = locks.filter(l => l.agentId === options.agent);
      if (options.task) locks = locks.filter(l => l.taskId === options.task);
      console.table(locks.map(l => ({
        file: l.file,
        task: l.taskId,
        agent: l.agentId,
        acquired: l.acquiredAt.toISOString(),
        expires: l.expiresAt?.toISOString()
      })));
    });

  return program;
}