import { Command } from 'commander';
import { bootstrap, shutdown } from './bootstrap.js';
import { Orchestrator } from './orchestrator.js';

let orchestrator: Orchestrator | null = null;

async function getOrchestrator(): Promise<Orchestrator> {
  if (!orchestrator) {
    const result = await bootstrap();
    if (!result.ok) {
      console.error(`Failed to bootstrap: ${result.error.message}`);
      process.exit(1);
    }
    orchestrator = result.value;
  }
  return orchestrator;
}

export async function createCLI(): Promise<Command> {
  const program = new Command();

  program
    .name('agent-platform')
    .description('Modular, model-agnostic autonomous AI agent platform')
    .version('0.1.0');

  program
    .command('start')
    .description('Start the agent platform')
    .option('-a, --agent <id>', 'Agent ID to start (agent_a or agent_b)')
    .action(async (options) => {
      const orch = await getOrchestrator();
      console.log('Agent platform started');
      if (options.agent) {
        console.log(`Starting agent: ${options.agent}`);
      }
      // Keep running
      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await shutdown(orch);
        process.exit(0);
      });
    });

  program
    .command('run-task <taskId>')
    .description('Run a specific task')
    .option('-a, --agent <id>', 'Agent ID (agent_a or agent_b)', 'agent_a')
    .action(async (taskId, options) => {
      const orch = await getOrchestrator();
      console.log(`Running task ${taskId} with agent ${options.agent}`);
      // TODO: Implement task execution
    });

  program
    .command('health')
    .description('Check system health')
    .action(async () => {
      const orch = await getOrchestrator();
      const health = await orch.getHealth().getHealth();
      console.log('Health Status:', health.status);
      console.log('Uptime:', Math.round(health.uptime / 1000), 'seconds');
      console.table(Object.entries(health.checks).map(([name, check]) => ({
        check: name,
        status: check.status,
        message: check.message
      })));
    });

  program
    .command('config')
    .description('Manage configuration')
    .option('--show', 'Show current config')
    .option('--set <key=value>', 'Set config value')
    .action(async (options) => {
      const orch = await getOrchestrator();
      const config = orch.getConfig().getConfig();

      if (options.show) {
        console.log(JSON.stringify(config, null, 2));
      }

      if (options.set) {
        const [key, ...valueParts] = options.set.split('=');
        const value = valueParts.join('=');
        // TODO: Implement config update
        console.log(`Setting ${key}=${value}`);
      }
    });

  program
    .command('provider')
    .description('Manage LLM providers')
    .option('--list', 'List configured providers')
    .option('--test <name>', 'Test provider connection')
    .action(async (options) => {
      const orch = await getOrchestrator();
      const factory = orch.getProviderFactory();

      if (options.list) {
        const providers = factory.getConfiguredProviders();
        console.log('Configured providers:', providers.join(', '));
      }

      if (options.test) {
        const provider = factory.getProvider(options.test);
        const healthy = await provider.healthCheck();
        console.log(`${options.test}: ${healthy ? 'OK' : 'FAILED'}`);
      }
    });

  program
    .command('worktree')
    .description('Manage git worktrees')
    .option('--list', 'List worktrees')
    .option('--create <path> <branch>', 'Create worktree')
    .option('--remove <path>', 'Remove worktree')
    .action(async (options) => {
      const { createWorktreeManager } = await import('@git/worktree-manager.js');
      const manager = createWorktreeManager();

      if (options.list) {
        const result = await manager.list();
        if (result.ok) {
          console.table(result.value.map(w => ({
            path: w.path,
            branch: w.branch,
            commit: w.commit.substring(0, 8)
          })));
        }
      }

      if (options.create) {
        // Parse path and branch from args
        console.log('Worktree create not fully implemented in CLI');
      }
    });

  program
    .command('task')
    .description('Manage tasks')
    .option('--list', 'List all tasks')
    .option('--claim <id>', 'Claim a task')
    .option('--complete <id>', 'Complete a task')
    .option('--agent <id>', 'Agent ID', 'agent_a')
    .action(async (options) => {
      const { taskRegistry } = await import('@tasks/task-registry.js');
      await taskRegistry.load();

      if (options.list) {
        const tasks = taskRegistry.getAllTasks();
        console.table(tasks.map(t => ({
          id: t.task_id,
          owner: t.owner,
          status: t.status,
          description: t.description.substring(0, 60)
        })));
      }

      if (options.claim) {
        await taskRegistry.updateTask(options.claim, { status: 'IN_PROGRESS' });
        console.log(`Task ${options.claim} claimed by ${options.agent}`);
      }

      if (options.complete) {
        await taskRegistry.updateTask(options.complete, { status: 'COMPLETED' });
        console.log(`Task ${options.complete} completed by ${options.agent}`);
      }
    });

  program
    .command('memory')
    .description('Manage project memory')
    .option('--search <query>', 'Search memory')
    .option('--stats', 'Show memory stats')
    .action(async (options) => {
      console.log('Memory commands not fully implemented');
    });

  return program;
}