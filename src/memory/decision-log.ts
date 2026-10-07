import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { resolve, join } from 'path';
import { ResultOrError, ok, err } from '@core/types.js';
import { generateId } from '@core/utils.js';
import { MemoryError } from '@core/errors.js';

const DECISIONS_DIR = resolve(process.cwd(), '.ai', 'decisions');

export interface DecisionEntry {
  id: string;
  title: string;
  description: string;
  context: Record<string, unknown>;
  decision: string;
  rationale: string;
  alternatives: string[];
  tags: string[];
  author: string;
  createdAt: Date;
  relatedTasks: string[];
  relatedFiles: string[];
}

export class DecisionLog {
  private cache = new Map<string, DecisionEntry>();

  async initialize(): Promise<ResultOrError<void>> {
    try {
      await mkdir(DECISIONS_DIR, { recursive: true });
      await this.loadCache();
      return ok(undefined);
    } catch (e) {
      return err(new MemoryError(`Failed to initialize decision log: ${e instanceof Error ? e.message : 'Unknown error'}`, 'initialize', e instanceof Error ? e : undefined));
    }
  }

  private async loadCache(): Promise<void> {
    try {
      const files = await readdir(DECISIONS_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await readFile(join(DECISIONS_DIR, file), 'utf-8');
          const entry = JSON.parse(content) as DecisionEntry;
          entry.createdAt = new Date(entry.createdAt);
          this.cache.set(entry.id, entry);
        }
      }
    } catch {
      // Ignore
    }
  }

  async record(entry: Omit<DecisionEntry, 'id' | 'createdAt'>): Promise<ResultOrError<DecisionEntry>> {
    try {
      const decision: DecisionEntry = {
        ...entry,
        id: generateId('dec'),
        createdAt: new Date()
      };

      this.cache.set(decision.id, decision);
      await this.persist(decision);
      return ok(decision);
    } catch (e) {
      return err(new MemoryError(`Failed to record decision: ${e instanceof Error ? e.message : 'Unknown error'}`, 'record', e instanceof Error ? e : undefined));
    }
  }

  async get(id: string): Promise<DecisionEntry | undefined> {
    return this.cache.get(id);
  }

  async search(query: string, tags?: string[], limit = 20): Promise<DecisionEntry[]> {
    const results: DecisionEntry[] = [];
    const queryLower = query.toLowerCase();

    for (const entry of this.cache.values()) {
      if (tags && tags.length > 0 && !tags.some(t => entry.tags.includes(t))) continue;

      const matches = entry.title.toLowerCase().includes(queryLower) ||
        entry.description.toLowerCase().includes(queryLower) ||
        entry.decision.toLowerCase().includes(queryLower) ||
        entry.rationale.toLowerCase().includes(queryLower);

      if (matches) results.push(entry);
    }

    return results
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getByTag(tag: string, limit = 20): Promise<DecisionEntry[]> {
    return Array.from(this.cache.values())
      .filter(e => e.tags.includes(tag))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getByTask(taskId: string): Promise<DecisionEntry[]> {
    return Array.from(this.cache.values())
      .filter(e => e.relatedTasks.includes(taskId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getAll(limit = 50): Promise<DecisionEntry[]> {
    return Array.from(this.cache.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  private async persist(entry: DecisionEntry): Promise<void> {
    await writeFile(join(DECISIONS_DIR, `${entry.id}.json`), JSON.stringify(entry, null, 2), 'utf-8');
  }
}

export function createDecisionLog(): DecisionLog {
  return new DecisionLog();
}