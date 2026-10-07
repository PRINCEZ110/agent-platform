import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { ResultOrError, ok, err } from '@core/types.js';

const CONFIG_DIR = resolve(process.cwd(), '.ai', 'config');
const CONFIG_FILE = resolve(CONFIG_DIR, 'app.json');

export interface AppConfig {
  agentA: {
    model: string;
    provider: string;
    temperature: number;
    maxIterations: number;
    systemPrompt: string;
  };
  agentB: {
    model: string;
    provider: string;
    temperature: number;
    maxIterations: number;
    systemPrompt: string;
  };
  providers: Record<string, any>;
  tools: {
    enabled: string[];
    timeouts: Record<string, number>;
  };
  git: {
    mainBranch: string;
    worktreeBase: string;
  };
  memory: {
    vectorStore: 'memory' | 'embedding';
    maxEntries: number;
  };
  safety: {
    strictMode: boolean;
    auditRetentionDays: number;
  };
  observability: {
    logLevel: string;
    metricsEnabled: boolean;
    tracingEnabled: boolean;
    healthCheckInterval: number;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  agentA: {
    model: 'gpt-4-turbo-preview',
    provider: 'openai',
    temperature: 0.3,
    maxIterations: 10,
    systemPrompt: 'You are Agent A, the Lead Architect. Your role is to plan, review, and integrate. You own core architecture, providers, tools, git, communication, memory, tasks, safety, and observability.'
  },
  agentB: {
    model: 'gpt-4-turbo-preview',
    provider: 'openai',
    temperature: 0.5,
    maxIterations: 15,
    systemPrompt: 'You are Agent B, the Specialist Engineer. Your role is to implement, test, and document. You own specialist agent, UI, tests, docs, and examples.'
  },
  providers: {},
  tools: {
    enabled: ['terminal', 'fs.read', 'fs.write', 'fs.list', 'fs.stat', 'git.status', 'git.diff', 'git.log', 'git.branch', 'git.commit', 'git.push', 'git.pull', 'git.add', 'git.stash', 'git.worktree', 'web.search', 'web.fetch', 'code.analyze', 'code.references'],
    timeouts: { terminal: 30000, default: 30000 }
  },
  git: {
    mainBranch: 'main',
    worktreeBase: 'worktrees'
  },
  memory: {
    vectorStore: 'memory',
    maxEntries: 10000
  },
  safety: {
    strictMode: true,
    auditRetentionDays: 90
  },
  observability: {
    logLevel: 'info',
    metricsEnabled: true,
    tracingEnabled: true,
    healthCheckInterval: 30000
  }
};

export class ConfigManager {
  private config: AppConfig = DEFAULT_CONFIG;

  async load(): Promise<ResultOrError<AppConfig>> {
    try {
      await mkdir(CONFIG_DIR, { recursive: true });
      const content = await readFile(CONFIG_FILE, 'utf-8');
      this.config = { ...DEFAULT_CONFIG, ...JSON.parse(content) };
      return ok(this.config);
    } catch {
      this.config = DEFAULT_CONFIG;
      await this.save();
      return ok(this.config);
    }
  }

  getConfig(): AppConfig {
    return this.config;
  }

  async save(): Promise<ResultOrError<void>> {
    try {
      await writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
      return ok(undefined);
    } catch (e) {
      return err(new Error(`Failed to save config: ${e instanceof Error ? e.message : 'Unknown error'}`));
    }
  }

  async update(updates: Partial<AppConfig>): Promise<ResultOrError<AppConfig>> {
    this.config = { ...this.config, ...updates };
    return this.save().then(() => ok(this.config));
  }

  getAgentAConfig() { return this.config.agentA; }
  getAgentBConfig() { return this.config.agentB; }
  getProviderConfig(name: string) { return this.config.providers[name]; }
  getToolsConfig() { return this.config.tools; }
  getGitConfig() { return this.config.git; }
  getMemoryConfig() { return this.config.memory; }
  getSafetyConfig() { return this.config.safety; }
  getObservabilityConfig() { return this.config.observability; }
}

export const configManager = new ConfigManager();