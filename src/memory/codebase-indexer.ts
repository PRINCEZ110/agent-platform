import { glob } from 'glob';
import { readFile } from 'fs/promises';
import { resolve, relative } from 'path';
import { VectorStore, VectorDocument } from './vector-store.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { MemoryError } from '@core/errors.js';

const projectRoot = resolve(process.cwd());

export interface CodebaseIndexConfig {
  includePatterns: string[];
  excludePatterns: string[];
  maxFileSize: number;
  chunkSize: number;
  chunkOverlap: number;
}

export const DEFAULT_INDEX_CONFIG: CodebaseIndexConfig = {
  includePatterns: ['**/*.{ts,tsx,js,jsx,py,json,md,yaml,yml}'],
  excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**'],
  maxFileSize: 100000,
  chunkSize: 2000,
  chunkOverlap: 200
};

export class CodebaseIndexer {
  private vectorStore: VectorStore;
  private config: CodebaseIndexConfig;
  private indexedFiles = new Set<string>();

  constructor(vectorStore: VectorStore, config: Partial<CodebaseIndexConfig> = {}) {
    this.vectorStore = vectorStore;
    this.config = { ...DEFAULT_INDEX_CONFIG, ...config };
  }

  async index(): Promise<ResultOrError<{ files: number; chunks: number }>> {
    try {
      const files = await this.findFiles();
      let chunks = 0;

      for (const file of files) {
        const fileChunks = await this.indexFile(file);
        chunks += fileChunks;
        this.indexedFiles.add(file);
      }

      return ok({ files: files.length, chunks });
    } catch (e) {
      return err(new MemoryError(`Failed to index codebase: ${e instanceof Error ? e.message : 'Unknown error'}`, 'index', e instanceof Error ? e : undefined));
    }
  }

  async indexFile(filePath: string): Promise<number> {
    try {
      const content = await readFile(filePath, 'utf-8');
      if (content.length > this.config.maxFileSize) {
        return 0;
      }

      const chunks = this.chunkContent(content, filePath);
      const documents: VectorDocument[] = chunks.map((chunk, i) => ({
        id: `${filePath}:${i}`,
        content: chunk,
        metadata: { file: filePath, chunk: i, language: this.detectLanguage(filePath) }
      }));

      await this.vectorStore.addBatch(documents);
      return chunks.length;
    } catch {
      return 0;
    }
  }

  async reindexFile(filePath: string): Promise<number> {
    // Delete old chunks
    const allDocs = await this.vectorStore.search(filePath, 1000);
    for (const doc of allDocs) {
      if (doc.metadata['file'] === filePath) {
        await this.vectorStore.delete(doc.id);
      }
    }
    return this.indexFile(filePath);
  }

  async removeFile(filePath: string): Promise<void> {
    const allDocs = await this.vectorStore.search(filePath, 1000);
    for (const doc of allDocs) {
      if (doc.metadata['file'] === filePath) {
        await this.vectorStore.delete(doc.id);
      }
    }
    this.indexedFiles.delete(filePath);
  }

  async search(query: string, limit = 10): Promise<Array<{ file: string; content: string; score: number }>> {
    const results = await this.vectorStore.search(query, limit);
    return results.map(r => ({
      file: r.metadata['file'] as string,
      content: r.content,
      score: r.score
    }));
  }

  getIndexedFiles(): string[] {
    return Array.from(this.indexedFiles);
  }

  private async findFiles(): Promise<string[]> {
    const files: string[] = [];
    for (const pattern of this.config.includePatterns) {
      const matches = await glob(pattern, {
        cwd: projectRoot,
        absolute: true,
        ignore: this.config.excludePatterns
      });
      files.push(...matches);
    }
    return [...new Set(files)];
  }

  private chunkContent(content: string, filePath: string): string[] {
    const lines = content.split('\n');
    const chunks: string[] = [];
    let currentChunk = '';
    let lineCount = 0;

    for (const line of lines) {
      currentChunk += line + '\n';
      lineCount++;

      if (lineCount >= this.config.chunkSize) {
        chunks.push(currentChunk.trim());
        // Overlap: keep last chunkOverlap lines
        const overlapLines = currentChunk.split('\n').slice(-this.config.chunkOverlap);
        currentChunk = overlapLines.join('\n') + '\n';
        lineCount = overlapLines.length;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      json: 'json',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml'
    };
    return langMap[ext ?? ''] ?? 'text';
  }
}

export function createCodebaseIndexer(vectorStore: VectorStore, config?: Partial<CodebaseIndexConfig>): CodebaseIndexer {
  return new CodebaseIndexer(vectorStore, config);
}