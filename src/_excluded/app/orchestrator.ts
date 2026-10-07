import { ResultOrError, ok, err } from '@core/types.js';
import { AppError } from '@core/errors.js';
import { configManager } from './config.js';
import { createLogger } from '@obs/logger.js';
import { createMetrics } from '@obs/metrics.js';
import { createTracer } from '@obs/tracer.js';
import { createHealthMonitor } from '@obs/health.js';
import { createMemoryStore } from '@memory/memory-store.js';
import { createVectorStore } from '@memory/vector-store.js';
import { createCodebaseIndexer } from '@memory/codebase-indexer.js';
import { createDecisionLog } from '@memory/decision-log.js';
import { createContextBuilder } from '@memory/context-builder.js';
import { createMessageBus } from '@comm/message-bus.js';
import { persistence } from '@comm/persistence.js';
import { createWorktreeManager } from '@git/worktree-manager.js';
import { createBranchManager } from '@git/branch-manager.js';
import { createMergeCoordinator } from '@git/merge-coordinator.js';
import { createDiffAnalyzer } from '@git/diff-analyzer.js';
import { permissionsManager } from '@safety/permissions.js';
import { permissionChecker } from '@safety/checker.js';
import { approvalGate } from '@safety/approval-gate.js';
import { auditLog } from '@safety/audit-log.js';
import { toolRegistry, terminalTool, readFileTool, writeFileTool, listDirTool, deleteTool, statTool, copyTool, gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool, gitPushTool, gitPullTool, gitAddTool, gitStashTool, gitWorktreeTool, webSearchTool, fetchUrlTool, analyzeFileTool, findReferencesTool } from '@tools/index.js';
import { ProviderFactory } from '@providers/factory.js';
import { BaseAgent } from '@agents/base/base-agent.js';

export interface OrchestratorState {
  initialized: boolean;
  running: boolean;
  agents: Map<string, BaseAgent>;
}

export class Orchestrator {
  private state: OrchestratorState = {
    initialized: false,
    running: false,
    agents: new Map()
  };

  private logger = createLogger();
  private metrics = createMetrics();
  private tracer = createTracer();
  private health = createHealthMonitor();
  private config = configManager;
  private providerFactory = new ProviderFactory();

  async initialize(): Promise<ResultOrError<void>> {
    if (this.state.initialized) return ok(undefined);

    this.logger.info('Initializing orchestrator...');

    try {
      // Load config
      await this.config.load();

      // Initialize core services
      await this.initializeObservability();
      await this.initializeMemory();
      await this.initializeCommunication();
      await this.initializeGit();
      await this.initializeSafety();
      await this.initializeTools();
      await this.initializeProviders();

      // Register health checks
      this.registerHealthChecks();

      this.state.initialized = true;
      this.logger.info('Orchestrator initialized successfully');
      return ok(undefined);
    } catch (e) {
      this.logger.error('Failed to initialize orchestrator', { error: e instanceof Error ? e.message : 'Unknown' });
      return err(new AppError(`Orchestrator initialization failed: ${e instanceof Error ? e.message : 'Unknown error'}`));
    }
  }

  private async initializeObservability(): Promise<void> {
    const obsConfig = this.config.getObservabilityConfig();
    this.logger = createLogger({ level: obsConfig.logLevel as any });
    this.metrics = createMetrics();
    this.tracer = createTracer();
    this.health = createHealthMonitor();
  }

  private async initializeMemory(): Promise<void> {
    const memConfig = this.config.getMemoryConfig();
    const vectorStore = createVectorStore();
    await vectorStore.initialize();

    const memory = createMemoryStore(vectorStore);
    await memory.initialize();

    const indexer = createCodebaseIndexer(vectorStore);
    await indexer.index();

    const decisions = createDecisionLog();
    await decisions.initialize();

    const contextBuilder = createContextBuilder(memory, indexer, decisions);
  }

  private async initializeCommunication(): Promise<void> {
    // Message bus will be created per agent
    await persistence.loadMessages('system');
  }

  private async initializeGit(): Promise<void> {
    createWorktreeManager();
    createBranchManager();
    createMergeCoordinator();
    createDiffAnalyzer();
  }

  private async initializeSafety(): Promise<void> {
    await permissionsManager.initialize();
    await approvalGate.initialize();
    await auditLog.initialize();
  }

  private async initializeTools(): Promise<void> {
    const toolsConfig = this.config.getToolsConfig();
    for (const toolName of toolsConfig.enabled) {
      // Tools are registered in their respective modules
    }
  }

  private async initializeProviders(): Promise<void> {
    // Provider factory will load configs
  }

  private registerHealthChecks(): void {
    this.health.register({
      name: 'memory',
      critical: false,
      check: async () => ({ status: 'healthy', timestamp: new Date() })
    });

    this.health.register({
      name: 'providers',
      critical: false,
      check: async () => {
        const providers = this.providerFactory.getConfiguredProviders();
        let healthy = 0;
        for (const p of providers) {
          const provider = this.providerFactory.getProvider(p);
          if (await provider.healthCheck()) healthy++;
        }
        return {
          status: healthy > 0 ? 'healthy' : 'degraded',
          details: { total: providers.length, healthy },
          timestamp: new Date()
        };
      }
    });
  }

  registerAgent(id: string, agent: BaseAgent): void {
    this.state.agents.set(id, agent);
  }

  getAgent(id: string): BaseAgent | undefined {
    return this.state.agents.get(id);
  }

  async start(): Promise<ResultOrError<void>> {
    if (!this.state.initialized) {
      return err(new AppError('Orchestrator not initialized'));
    }
    if (this.state.running) return ok(undefined);

    this.state.running = true;
    this.logger.info('Orchestrator started');
    return ok(undefined);
  }

  async stop(): Promise<void> {
    this.state.running = false;
    this.health.shutdown();
    await this.tracer.shutdown();
    await this.metrics.getMetrics(); // Flush
    this.logger.info('Orchestrator stopped');
  }

  getState(): OrchestratorState {
    return { ...this.state };
  }

  getLogger() { return this.logger; }
  getMetrics() { return this.metrics; }
  getTracer() { return this.tracer; }
  getHealth() { return this.health; }
  getConfig() { return this.config; }
  getProviderFactory() { return this.providerFactory; }
}

export const orchestrator = new Orchestrator();