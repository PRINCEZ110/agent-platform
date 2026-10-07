import { ResultOrError, ok, err } from '@core/types.js';
import { MemoryError } from '@core/errors.js';

export interface VectorDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export interface VectorSearchResult {
  id: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  initialize(): Promise<ResultOrError<void>>;
  add(doc: VectorDocument): Promise<ResultOrError<void>>;
  addBatch(docs: VectorDocument[]): Promise<ResultOrError<void>>;
  delete(id: string): Promise<ResultOrError<void>>;
  search(query: string, limit: number): Promise<VectorSearchResult[]>;
  get(id: string): Promise<VectorDocument | undefined>;
  clear(): Promise<ResultOrError<void>>;
}

export class InMemoryVectorStore implements VectorStore {
  private documents = new Map<string, VectorDocument>();

  async initialize(): Promise<ResultOrError<void>> {
    return ok(undefined);
  }

  async add(doc: VectorDocument): Promise<ResultOrError<void>> {
    this.documents.set(doc.id, doc);
    return ok(undefined);
  }

  async addBatch(docs: VectorDocument[]): Promise<ResultOrError<void>> {
    for (const doc of docs) {
      this.documents.set(doc.id, doc);
    }
    return ok(undefined);
  }

  async delete(id: string): Promise<ResultOrError<void>> {
    this.documents.delete(id);
    return ok(undefined);
  }

  async search(query: string, limit: number): Promise<VectorSearchResult[]> {
    // Simple text-based search fallback
    const results: VectorSearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const doc of this.documents.values()) {
      const contentLower = doc.content.toLowerCase();
      if (contentLower.includes(queryLower)) {
        // Simple scoring based on occurrence count
        const count = (contentLower.match(new RegExp(queryLower, 'g')) || []).length;
        results.push({ id: doc.id, score: count, content: doc.content, metadata: doc.metadata });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async get(id: string): Promise<VectorDocument | undefined> {
    return this.documents.get(id);
  }

  async clear(): Promise<ResultOrError<void>> {
    this.documents.clear();
    return ok(undefined);
  }
}

export class EmbeddingVectorStore implements VectorStore {
  private documents = new Map<string, VectorDocument>();
  private embedder: (text: string) => Promise<number[]>;

  constructor(embedder: (text: string) => Promise<number[]>) {
    this.embedder = embedder;
  }

  async initialize(): Promise<ResultOrError<void>> {
    return ok(undefined);
  }

  async add(doc: VectorDocument): Promise<ResultOrError<void>> {
    try {
      const embedding = await this.embedder(doc.content);
      this.documents.set(doc.id, { ...doc, embedding });
      return ok(undefined);
    } catch (e) {
      return err(new MemoryError(`Failed to add document: ${e instanceof Error ? e.message : 'Unknown error'}`, 'add', e instanceof Error ? e : undefined));
    }
  }

  async addBatch(docs: VectorDocument[]): Promise<ResultOrError<void>> {
    try {
      for (const doc of docs) {
        const embedding = await this.embedder(doc.content);
        this.documents.set(doc.id, { ...doc, embedding });
      }
      return ok(undefined);
    } catch (e) {
      return err(new MemoryError(`Failed to add batch: ${e instanceof Error ? e.message : 'Unknown error'}`, 'addBatch', e instanceof Error ? e : undefined));
    }
  }

  async delete(id: string): Promise<ResultOrError<void>> {
    this.documents.delete(id);
    return ok(undefined);
  }

  async search(query: string, limit: number): Promise<VectorSearchResult[]> {
    try {
      const queryEmbedding = await this.embedder(query);
      const results: VectorSearchResult[] = [];

      for (const doc of this.documents.values()) {
        if (!doc.embedding) continue;
        const score = cosineSimilarity(queryEmbedding, doc.embedding);
        results.push({ id: doc.id, score, content: doc.content, metadata: doc.metadata });
      }

      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (e) {
      return [];
    }
  }

  async get(id: string): Promise<VectorDocument | undefined> {
    return this.documents.get(id);
  }

  async clear(): Promise<ResultOrError<void>> {
    this.documents.clear();
    return ok(undefined);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function createVectorStore(embedder?: (text: string) => Promise<number[]>): VectorStore {
  return embedder ? new EmbeddingVectorStore(embedder) : new InMemoryVectorStore();
}