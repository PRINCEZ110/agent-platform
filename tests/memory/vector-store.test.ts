import { describe, it, expect, vi } from 'vitest';
import {
  InMemoryVectorStore,
  EmbeddingVectorStore,
  createVectorStore,
  VectorDocument
} from '../../src/memory/vector-store.js';

const doc = (id: string, content: string, metadata: Record<string, unknown> = {}): VectorDocument => ({
  id,
  content,
  metadata
});

describe('InMemoryVectorStore', () => {
  it('initializes ok and starts empty', async () => {
    const store = new InMemoryVectorStore();
    expect((await store.initialize()).ok).toBe(true);
    expect(await store.get('missing')).toBeUndefined();
    expect(await store.search('anything', 10)).toEqual([]);
  });

  it('adds, gets, deletes documents', async () => {
    const store = new InMemoryVectorStore();
    expect((await store.add(doc('1', 'hello world'))).ok).toBe(true);
    expect((await store.get('1'))?.content).toBe('hello world');

    expect((await store.delete('1')).ok).toBe(true);
    expect(await store.get('1')).toBeUndefined();
    expect((await store.delete('missing')).ok).toBe(true);
  });

  it('addBatch stores every document', async () => {
    const store = new InMemoryVectorStore();
    await store.addBatch([doc('a', 'alpha'), doc('b', 'beta'), doc('c', 'gamma')]);
    expect(await store.get('a')).toBeDefined();
    expect(await store.get('b')).toBeDefined();
    expect(await store.get('c')).toBeDefined();
  });

  it('search matches content case-insensitively, scores by occurrence, honors limit', async () => {
    const store = new InMemoryVectorStore();
    await store.addBatch([
      doc('one', 'error handling one error'),
      doc('two', 'error handling'),
      doc('three', 'unrelated content')
    ]);

    const results = await store.search('error', 10);
    expect(results.map(r => r.id)).toEqual(['one', 'two']);
    expect(results[0].score).toBe(2);
    expect(results[1].score).toBe(1);
    expect(results[0].content).toBe('error handling one error');
    expect(results[0].metadata).toEqual({});

    expect(await store.search('error', 1)).toHaveLength(1);
    expect(await store.search('ERROR', 10)).toHaveLength(2);
    expect(await store.search('nothing-matches', 10)).toEqual([]);
  });

  it.fails('BUG-006: search with a regex-special query (e.g. "c++") throws instead of matching', async () => {
    const store = new InMemoryVectorStore();
    await store.add(doc('cpp', 'learn c++ today'));
    const results = await store.search('c++', 5);
    expect(results).toHaveLength(1);
  });

  it('clear removes everything', async () => {
    const store = new InMemoryVectorStore();
    await store.add(doc('1', 'x'));
    expect((await store.clear()).ok).toBe(true);
    expect(await store.get('1')).toBeUndefined();
  });
});

describe('EmbeddingVectorStore', () => {
  it('embeds on add and stores the embedding', async () => {
    const embedder = vi.fn(async (text: string) => [text.length, 1]);
    const store = new EmbeddingVectorStore(embedder);

    const result = await store.add(doc('1', 'hello'));
    expect(result.ok).toBe(true);
    expect(embedder).toHaveBeenCalledWith('hello');
    expect((await store.get('1'))?.embedding).toEqual([5, 1]);
  });

  it('returns a MemoryError result when the embedder fails on add', async () => {
    const store = new EmbeddingVectorStore(async () => {
      throw new Error('embed down');
    });
    const result = await store.add(doc('1', 'x'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('MemoryError');
  });

  it('addBatch embeds each document and fails with MemoryError on error', async () => {
    const good = new EmbeddingVectorStore(async t => [t.length]);
    expect((await good.addBatch([doc('a', 'ab'), doc('b', 'abc')])).ok).toBe(true);
    expect((await good.get('a'))?.embedding).toEqual([2]);
    expect((await good.get('b'))?.embedding).toEqual([3]);

    const bad = new EmbeddingVectorStore(async t => {
      if (t === 'boom') throw new Error('x');
      return [1];
    });
    const result = await bad.addBatch([doc('ok', 'fine'), doc('bad', 'boom')]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('MemoryError');
  });

  it('search ranks by cosine similarity', async () => {
    const vectors: Record<string, number[]> = {
      query: [1, 0],
      exact: [1, 0],
      close: [0.9, 0.1],
      far: [0, 1]
    };
    const store = new EmbeddingVectorStore(async t => vectors[t] ?? [0, 0]);

    await store.addBatch([doc('d1', 'exact'), doc('d2', 'close'), doc('d3', 'far')]);
    const results = await store.search('query', 10);

    expect(results.map(r => r.id)).toEqual(['d1', 'd2', 'd3']);
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[2].score).toBeCloseTo(0, 5);
    expect(await store.search('query', 2)).toHaveLength(2);
  });

  it('returns [] when the query embedder throws', async () => {
    const store = new EmbeddingVectorStore(async t => {
      if (t === 'bad-query') throw new Error('x');
      return [1];
    });
    await store.add(doc('1', 'content'));
    expect(await store.search('bad-query', 5)).toEqual([]);
  });

  it('scores 0 for mismatched embedding dimensions', async () => {
    const store = new EmbeddingVectorStore(async t => (t.length <= 4 ? [1, 0] : [1, 0, 0]));
    await store.add(doc('short', 'ab'));
    await store.add(doc('long', 'abcdef'));
    const results = await store.search('abcdef', 5);
    const short = results.find(r => r.id === 'short');
    expect(short?.score).toBe(0);
  });

  it('delete and clear remove documents', async () => {
    const store = new EmbeddingVectorStore(async () => [1]);
    await store.add(doc('1', 'x'));
    await store.delete('1');
    expect(await store.get('1')).toBeUndefined();
    await store.add(doc('2', 'y'));
    await store.clear();
    expect(await store.get('2')).toBeUndefined();
  });
});

describe('createVectorStore', () => {
  it('returns InMemoryVectorStore without an embedder and EmbeddingVectorStore with one', () => {
    expect(createVectorStore()).toBeInstanceOf(InMemoryVectorStore);
    expect(createVectorStore(async () => [1])).toBeInstanceOf(EmbeddingVectorStore);
  });
});
