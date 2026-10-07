import { MemoryStore } from './memory-store.js';
import { CodebaseIndexer } from './codebase-indexer.js';
import { DecisionLog } from './decision-log.js';
import { ResultOrError, ok } from '@core/types.js';
import { TaskContext } from '@agents/interfaces/agent-interface.js';

export interface ContextBundle {
  task: TaskContext;
  relevantCode: Array<{ file: string; content: string; score: number }>;
  relevantDecisions: Array<{ id: string; title: string; decision: string; rationale: string }>;
  memory: Record<string, unknown>;
  agentPreferences: Record<string, unknown>;
  projectStructure: string;
  timestamp: Date;
}

export class ContextBuilder {
  private memory: MemoryStore;
  private indexer: CodebaseIndexer;
  private decisions: DecisionLog;

  constructor(memory: MemoryStore, indexer: CodebaseIndexer, decisions: DecisionLog) {
    this.memory = memory;
    this.indexer = indexer;
    this.decisions = decisions;
  }

  async buildContext(task: TaskContext, options?: { maxCodeResults?: number; maxDecisions?: number }): Promise<ResultOrError<ContextBundle>> {
    const { maxCodeResults = 10, maxDecisions = 5 } = options ?? {};

    const query = `${task.title} ${task.description} ${task.files.join(' ')}`;

    const [codeResults, decisionResults, memoryEntries, preferences] = await Promise.all([
      this.indexer.search(query, maxCodeResults),
      this.decisions.search(query, undefined, maxDecisions),
      this.getRelevantMemory(task),
      this.getAgentPreferences()
    ]);

    const projectStructure = await this.getProjectStructure();

    return ok({
      task,
      relevantCode: codeResults,
      relevantDecisions: decisionResults.map(d => ({ id: d.id, title: d.title, decision: d.decision, rationale: d.rationale })),
      memory: memoryEntries,
      agentPreferences: preferences,
      projectStructure,
      timestamp: new Date()
    });
  }

  private async getRelevantMemory(task: TaskContext): Promise<Record<string, unknown>> {
    const keys = await this.memory.getAllKeys();
    const relevant: Record<string, unknown> = {};

    for (const key of keys) {
      if (key.includes(task.taskId) || task.files.some(f => key.includes(f))) {
        const value = await this.memory.get(key);
        if (value !== undefined) relevant[key] = value;
      }
    }

    return relevant;
  }

  private async getAgentPreferences(): Promise<Record<string, unknown>> {
    const prefs = await this.memory.get('agent:preferences');
    return (prefs as Record<string, unknown>) ?? {};
  }

  private async getProjectStructure(): Promise<string> {
    const structure = await this.memory.get('project:structure');
    return (structure as string) ?? '';
  }

  async updateProjectStructure(): Promise<void> {
    const files = this.indexer.getIndexedFiles();
    const tree = this.buildTree(files);
    await this.memory.set('project:structure', tree, { metadata: { type: 'project_structure' } });
  }

  private buildTree(files: string[]): string {
    const tree: Record<string, unknown> = {};
    for (const file of files) {
      const parts = file.split('/');
      let current: Record<string, unknown> = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!part) continue;
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }
      const lastPart = parts[parts.length - 1];
      if (lastPart) {
        current[lastPart] = null;
      }
    }
    return JSON.stringify(tree, null, 2);
  }
}

export function createContextBuilder(memory: MemoryStore, indexer: CodebaseIndexer, decisions: DecisionLog): ContextBuilder {
  return new ContextBuilder(memory, indexer, decisions);
}