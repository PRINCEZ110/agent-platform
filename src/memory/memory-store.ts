import { readFile, writeFile, mkdir, readdir, rm } from 'fs/promises';
import { resolve, join } from 'path';
import { ResultOrError, ok, err } from '@core/types.js';
import { MemoryError } from '@core/errors.js';
import { VectorStore, VectorDocument } from './vector-store.js';

const MEMORY_DIR = resolve(process.cwd(), '.ai', 'memory');

export interface MemoryEntry {
  key: string;
  value: unknown;
  type: 'structured' | 'vector';
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export class MemoryStore {
  private vectorStore: VectorStore;
  private cache = new Map<string, MemoryEntry>();

  constructor(vectorStore: VectorStore) {
    this.vectorStore = vectorStore;
  }

  async initialize(): Promise<ResultOrError<void>> {
    try {
      await mkdir(MEMORY_DIR, { recursive: true });
      await this.vectorStore.initialize();
      await this.loadCache();
      return ok(undefined);
    } catch (e) {
      return err(new MemoryError(`Failed to initialize memory store: ${e instanceof Error ? e.message : 'Unknown error'}`, 'initialize', e instanceof Error ? e : undefined));
    }
  }

  private async loadCache(): Promise<void> {
    try {
      const files = await readdir(MEMORY_DIR);
      for (const file of files) {
        if (file.endsWith('.json') && !file.startsWith('vector')) {
          const content = await readFile(join(MEMORY_DIR, file), 'utf-8');
          const entry = JSON.parse(content) as MemoryEntry;
          entry.createdAt = new Date(entry.createdAt);
          entry.updatedAt = new Date(entry.updatedAt);
          entry.expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : undefined;
          this.cache.set(entry.key, entry);
        }
      }
    } catch {
      // Ignore
    }
  }

  async set(key: string, value: unknown, options?: { metadata?: Record<string, unknown>; ttl?: number; vector?: boolean }): Promise<ResultOrError<void>> {
    try {
      const now = new Date();
      const entry: MemoryEntry = {
        key,
        value,
        type: options?.vector ? 'vector' : 'structured',
        metadata: options?.metadata ?? {},
        createdAt: now,
        updatedAt: now,
        expiresAt: options?.ttl ? new Date(now.getTime() + options.ttl) : undefined
      };

      this.cache.set(key, entry);
      await this.persistEntry(entry);

      if (options?.vector && typeof value === 'string') {
        await this.vectorStore.add({ id: key, content: value, metadata: entry.metadata });
      }

      return ok(undefined);
    } catch (e) {
      return err(new MemoryError(`Failed to set memory: ${e instanceof Error ? e.message : 'Unknown error'}`, 'set', e instanceof Error ? e : undefined));
    }
  }

  async get(key: string): Promise<unknown> {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      await this.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async delete(key: string): Promise<ResultOrError<void>> {
    try {
      this.cache.delete(key);
      await rm(join(MEMORY_DIR, `${key}.json`), { force: true });
      await this.vectorStore.delete(key);
      return ok(undefined);
    } catch (e) {
      return err(new MemoryError(`Failed to delete memory: ${e instanceof Error ? e.message : 'Unknown error'}`, 'delete', e instanceof Error ? e : undefined));
    }
  }

  async search(query: string, limit = 10): Promise<unknown[]> {
    const vectorResults = await this.vectorStore.search(query, limit);
    return vectorResults.map(r => r.metadata);
  }

  async getAllKeys(): Promise<string[]> {
    return Array.from(this.cache.keys());
  }

  async getEntriesByType(type: 'structured' | 'vector'): Promise<MemoryEntry[]> {
    return Array.from(this.cache.values()).filter(e => e.type === type);
  }

  async cleanup(): Promise<number> {
    let cleaned = 0;
    const now = new Date();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && entry.expiresAt < now) {
        await this.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  private async persistEntry(entry: MemoryEntry): Promise<void> {
    await writeFile(join(MEMORY_DIR, `${entry.key}.json`), JSON.stringify(entry, null, 2), 'utf-8');
  }

  getVectorStore(): VectorStore {
    return this.vectorStore;
  }
}

export function createMemoryStore(vectorStore: VectorStore): MemoryStore {
  return new MemoryStore(vectorStore);
}