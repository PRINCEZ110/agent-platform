import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir, readdir, rm } from 'fs/promises';
import { MemoryStore } from '../../src/memory/memory-store.js';
import { InMemoryVectorStore, VectorStore } from '../../src/memory/vector-store.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
  vi.mocked(rm).mockResolvedValue(undefined as never);
});

async function fresh(): Promise<{ store: MemoryStore; vectors: InMemoryVectorStore }> {
  const vectors = new InMemoryVectorStore();
  const store = new MemoryStore(vectors);
  expect((await store.initialize()).ok).toBe(true);
  vi.mocked(writeFile).mockClear();
  return { store, vectors };
}

describe('MemoryStore.initialize', () => {
  it('creates the memory directory and initializes the vector store', async () => {
    const { store } = await fresh();
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(await store.getAllKeys()).toEqual([]);
  });

  it('hydrates non-vector entries from disk and converts dates', async () => {
    vi.mocked(readdir).mockResolvedValue(['keep.json', 'vector-skipped.json'] as never);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        key: 'keep',
        value: { a: 1 },
        type: 'structured',
        metadata: {},
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z'
      }) as never
    );

    const store = new MemoryStore(new InMemoryVectorStore());
    expect((await store.initialize()).ok).toBe(true);
    expect(await store.getAllKeys()).toEqual(['keep']);
    expect(await store.get('keep')).toEqual({ a: 1 });
    expect(await store.get('vector-skipped')).toBeUndefined();
  });

  it('returns a MemoryError result on failure', async () => {
    vi.mocked(mkdir).mockRejectedValue(new Error('EACCES') as never);
    const store = new MemoryStore(new InMemoryVectorStore());
    const result = await store.initialize();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('MemoryError');
  });
});

describe('MemoryStore set/get/delete', () => {
  it('round-trips a structured value and persists it', async () => {
    const { store } = await fresh();
    const result = await store.set('greeting', 'hello', { metadata: { kind: 'note' } });

    expect(result.ok).toBe(true);
    expect(await store.get('greeting')).toBe('hello');
    expect(String(vi.mocked(writeFile).mock.calls[0][0])).toContain('greeting.json');
    expect((await store.getEntriesByType('structured')).map(e => e.key)).toEqual(['greeting']);
    expect(await store.getEntriesByType('vector')).toEqual([]);
  });

  it('indexes string values into the vector store when vector: true', async () => {
    const { store, vectors } = await fresh();
    await store.set('doc1', 'searchable content about testing', { vector: true, metadata: { tag: 'a' } });

    const stored = await vectors.get('doc1');
    expect(stored?.content).toBe('searchable content about testing');
    expect((await store.getEntriesByType('vector')).map(e => e.key)).toEqual(['doc1']);
  });

  it('returns a MemoryError result when persisting fails', async () => {
    const { store } = await fresh();
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full') as never);

    const result = await store.set('k', 'v');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('MemoryError');
  });

  it('returns undefined for unknown keys', async () => {
    const { store } = await fresh();
    expect(await store.get('missing')).toBeUndefined();
  });

  it('expires entries past their TTL and removes them', async () => {
    const { store, vectors } = await fresh();
    await store.set('stale', 'old', { ttl: -1000, vector: true });

    expect(await store.get('stale')).toBeUndefined();
    expect(vi.mocked(rm)).toHaveBeenCalled();
    expect(await vectors.get('stale')).toBeUndefined();
    expect(await store.getAllKeys()).not.toContain('stale');
  });

  it('delete removes the entry, file, and vector document', async () => {
    const { store, vectors } = await fresh();
    await store.set('gone', 'value', { vector: true });

    const result = await store.delete('gone');

    expect(result.ok).toBe(true);
    expect(await store.get('gone')).toBeUndefined();
    expect(await vectors.get('gone')).toBeUndefined();
    expect(vi.mocked(rm)).toHaveBeenCalled();
  });

  it('returns a MemoryError result when delete fails', async () => {
    const { store } = await fresh();
    await store.set('k', 'v');
    vi.mocked(rm).mockRejectedValue(new Error('locked') as never);

    const result = await store.delete('k');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('MemoryError');
  });
});

describe('MemoryStore search and cleanup', () => {
  it('search delegates to the vector store and maps results to metadata', async () => {
    const { store } = await fresh();
    await store.set('doc1', 'the quick brown fox', { vector: true, metadata: { tag: 'animal' } });
    await store.set('doc2', 'lazy dog sleeps', { vector: true, metadata: { tag: 'pet' } });

    const results = await store.search('fox');
    expect(results).toEqual([{ tag: 'animal' }]);
    expect(await store.search('no-match')).toEqual([]);
  });

  it('cleanup removes only expired entries and reports the count', async () => {
    const { store } = await fresh();
    await store.set('alive', 'stays', { ttl: 60_000 });
    await store.set('dead1', 'goes', { ttl: -1 });
    await store.set('dead2', 'goes', { ttl: -1 });

    const cleaned = await store.cleanup();

    expect(cleaned).toBe(2);
    expect(await store.getAllKeys()).toEqual(['alive']);
  });

  it('exposes its vector store', async () => {
    const { store, vectors } = await fresh();
    expect(store.getVectorStore()).toBe(vectors);
  });
});
