import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'fs/promises';
import { glob } from 'glob';
import { CodebaseIndexer } from '../../src/memory/codebase-indexer.js';
import { InMemoryVectorStore, EmbeddingVectorStore } from '../../src/memory/vector-store.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

vi.mock('glob', () => ({
  glob: vi.fn()
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('CodebaseIndexer.index', () => {
  it('globs include patterns with exclusions, indexes files, and counts chunks', async () => {
    vi.mocked(glob).mockResolvedValue(['/root/src/a.ts', '/root/src/b.ts'] as never);
    vi.mocked(readFile).mockResolvedValue('line one\nline two' as never);
    const store = new InMemoryVectorStore();
    const indexer = new CodebaseIndexer(store);

    const result = await indexer.index();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ files: 2, chunks: 2 });
    expect(vi.mocked(glob).mock.calls[0][1]).toMatchObject({
      absolute: true,
      ignore: expect.arrayContaining(['**/node_modules/**', '**/.git/**']) as never
    });
    expect(indexer.getIndexedFiles()).toEqual(['/root/src/a.ts', '/root/src/b.ts']);
    expect(await store.get('/root/src/a.ts:0')).toBeDefined();
  });

  it('deduplicates files matched by multiple include patterns', async () => {
    vi.mocked(glob).mockResolvedValue(['/root/only.ts'] as never);
    vi.mocked(readFile).mockResolvedValue('x' as never);
    const indexer = new CodebaseIndexer(new InMemoryVectorStore());

    const result = await indexer.index();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.files).toBe(1);
  });

  it('returns a MemoryError result when globbing fails', async () => {
    vi.mocked(glob).mockRejectedValue(new Error('glob exploded') as never);
    const indexer = new CodebaseIndexer(new InMemoryVectorStore());

    const result = await indexer.index();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('MemoryError');
  });
});

describe('CodebaseIndexer.indexFile', () => {
  it('chunks content and stores documents with metadata', async () => {
    vi.mocked(readFile).mockResolvedValue('a\nb\nc\nd' as never);
    const store = new InMemoryVectorStore();
    const indexer = new CodebaseIndexer(store, { chunkSize: 2, chunkOverlap: 1 });

    const count = await indexer.indexFile('src/x.ts');

    expect(count).toBe(3);
    expect(await store.get('src/x.ts:0')).toMatchObject({
      content: 'a\nb',
      metadata: { file: 'src/x.ts', chunk: 0, language: 'typescript' }
    });
    expect((await store.get('src/x.ts:2'))?.metadata.chunk).toBe(2);
  });

  it('skips files larger than maxFileSize', async () => {
    vi.mocked(readFile).mockResolvedValue('0123456789' as never);
    const indexer = new CodebaseIndexer(new InMemoryVectorStore(), { maxFileSize: 5 });
    expect(await indexer.indexFile('big.ts')).toBe(0);
  });

  it('returns 0 when the file cannot be read', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const indexer = new CodebaseIndexer(new InMemoryVectorStore());
    expect(await indexer.indexFile('missing.ts')).toBe(0);
  });

  it('detects languages from extensions', async () => {
    vi.mocked(readFile).mockResolvedValue('x = 1' as never);
    const store = new InMemoryVectorStore();
    const indexer = new CodebaseIndexer(store);

    await indexer.indexFile('script.py');
    await indexer.indexFile('notes.unknownext');

    expect((await store.get('script.py:0'))?.metadata.language).toBe('python');
    expect((await store.get('notes.unknownext:0'))?.metadata.language).toBe('text');
  });
});

describe('CodebaseIndexer reindex and remove', () => {
  it('reindex replaces chunks when using an embedding store', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('old content alpha' as never);
    const store = new EmbeddingVectorStore(async () => [1]);
    const indexer = new CodebaseIndexer(store);

    await indexer.indexFile('src/a.ts');
    vi.mocked(readFile).mockResolvedValueOnce('new content beta' as never);
    const count = await indexer.reindexFile('src/a.ts');

    expect(count).toBe(1);
    const docs = await store.search('src/a.ts', 100);
    const forFile = docs.filter(d => d.metadata.file === 'src/a.ts');
    expect(forFile).toHaveLength(1);
    expect(forFile[0].content).toBe('new content beta');
  });

  it('removeFile drops chunks and forgets the file (embedding store)', async () => {
    vi.mocked(readFile).mockResolvedValue('content here' as never);
    const store = new EmbeddingVectorStore(async () => [1]);
    const indexer = new CodebaseIndexer(store);

    await indexer.indexFile('src/b.ts');
    await indexer.removeFile('src/b.ts');

    const docs = await store.search('src/b.ts', 100);
    expect(docs.filter(d => d.metadata.file === 'src/b.ts')).toEqual([]);
    expect(indexer.getIndexedFiles()).toEqual([]);
  });

  it.fails('BUG-007: removeFile leaves stale chunks behind with the default InMemoryVectorStore', async () => {
    vi.mocked(readFile).mockResolvedValue('function foo() {}' as never);
    const store = new InMemoryVectorStore();
    const indexer = new CodebaseIndexer(store);

    await indexer.indexFile('src/c.ts');
    expect(await store.get('src/c.ts:0')).toBeDefined();
    await indexer.removeFile('src/c.ts');
    expect(await store.get('src/c.ts:0')).toBeUndefined();
  });

  it.fails('BUG-010: chunkOverlap is a no-op (overlap never retains content lines)', async () => {
    vi.mocked(readFile).mockResolvedValue('a\nb\nc\nd' as never);
    const store = new InMemoryVectorStore();
    const indexer = new CodebaseIndexer(store, { chunkSize: 2, chunkOverlap: 1 });

    await indexer.indexFile('src/x.ts');
    const second = (await store.get('src/x.ts:1'))?.content ?? '';
    expect(second.startsWith('b')).toBe(true);
  });
});

describe('CodebaseIndexer.search', () => {
  it('maps vector results to file/content/score', async () => {
    vi.mocked(readFile).mockResolvedValue('handles error recovery paths' as never);
    const indexer = new CodebaseIndexer(new InMemoryVectorStore());
    await indexer.indexFile('src/handler.ts');

    const results = await indexer.search('error', 5);

    expect(results).toEqual([
      { file: 'src/handler.ts', content: 'handles error recovery paths', score: 1 }
    ]);
    expect(await indexer.search('nothing-matches', 5)).toEqual([]);
  });
});
