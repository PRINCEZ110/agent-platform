import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { DecisionLog } from '../../src/memory/decision-log.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

const entry = (over: Record<string, unknown> = {}) => ({
  title: 'Use Zod for validation',
  description: 'We need runtime validation',
  context: { phase: 'foundation' },
  decision: 'Adopt Zod schemas everywhere',
  rationale: 'Type-safe and widely adopted',
  alternatives: ['io-ts', 'ajv'],
  tags: ['validation', 'foundation'],
  author: 'agent_a',
  relatedTasks: ['TASK-005'],
  relatedFiles: ['src/core/types.ts'],
  ...over
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
});

async function freshLog(): Promise<DecisionLog> {
  const log = new DecisionLog();
  expect((await log.initialize()).ok).toBe(true);
  vi.mocked(writeFile).mockClear();
  return log;
}

describe('DecisionLog.initialize', () => {
  it('creates the decisions directory and starts empty', async () => {
    const log = await freshLog();
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(await log.getAll()).toEqual([]);
  });

  it('hydrates entries from disk and converts createdAt to Date', async () => {
    vi.mocked(readdir).mockResolvedValue(['d1.json', 'corrupt.json'] as never);
    vi.mocked(readFile)
      .mockResolvedValueOnce(
        JSON.stringify({ id: 'dec-1', ...entry(), createdAt: '2026-10-01T00:00:00.000Z' }) as never
      )
      .mockRejectedValueOnce(new Error('bad json') as never);

    const log = new DecisionLog();
    const result = await log.initialize();

    expect(result.ok).toBe(true);
    const loaded = await log.get('dec-1');
    expect(loaded).toBeDefined();
    expect(loaded!.createdAt).toBeInstanceOf(Date);
    expect(await log.getAll()).toHaveLength(1);
  });

  it('returns a MemoryError result when initialization fails', async () => {
    vi.mocked(mkdir).mockRejectedValue(new Error('EACCES') as never);
    const log = new DecisionLog();
    const result = await log.initialize();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('MemoryError');
  });
});

describe('DecisionLog.record', () => {
  it('records a decision with generated id/timestamp and persists it', async () => {
    const log = await freshLog();

    const result = await log.record(entry() as never);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toMatch(/^dec-/);
      expect(result.value.createdAt).toBeInstanceOf(Date);
      expect(result.value.title).toBe('Use Zod for validation');
    }
    expect(String(vi.mocked(writeFile).mock.calls[0][0])).toContain('.json');
    expect(await log.get(result.ok ? result.value.id : '')).toBeDefined();
  });

  it('returns a MemoryError result when persisting fails', async () => {
    const log = await freshLog();
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full') as never);

    const result = await log.record(entry() as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('MemoryError');
  });
});

describe('DecisionLog search and listings', () => {
  async function seeded(): Promise<DecisionLog> {
    const log = await freshLog();
    await log.record(entry({ title: 'Adopt Vitest', description: 'fast runner', decision: 'use vitest', rationale: 'speed', tags: ['testing'], relatedTasks: ['TASK-017'] }) as never);
    await log.record(entry({ title: 'Branch strategy', description: 'worktrees', decision: 'feature branches', rationale: 'isolation', tags: ['git'], relatedTasks: ['TASK-002'] }) as never);
    await log.record(entry({ title: 'Zod everywhere', description: 'validation layer', decision: 'zod schemas', rationale: 'type safety', tags: ['validation', 'testing'], relatedTasks: ['TASK-005'] }) as never);
    return log;
  }

  it('search matches title, description, decision and rationale case-insensitively', async () => {
    const log = await seeded();
    expect((await log.search('vitest')).map(d => d.title)).toEqual(['Adopt Vitest']);
    expect((await log.search('ISOLATION')).map(d => d.title)).toEqual(['Branch strategy']);
    expect((await log.search('zod')).map(d => d.title)).toEqual(['Zod everywhere']);
    expect(await log.search('nothing-here')).toEqual([]);
  });

  it('search filters by any matching tag and honors limit', async () => {
    const log = await seeded();
    const testing = await log.search('', ['testing']);
    expect(testing.map(d => d.title).sort()).toEqual(['Adopt Vitest', 'Zod everywhere']);
    expect(await log.search('', ['testing'], 1)).toHaveLength(1);
    expect(await log.search('', ['nope'])).toEqual([]);
  });

  it('getByTag returns only tagged entries', async () => {
    const log = await seeded();
    expect((await log.getByTag('git')).map(d => d.title)).toEqual(['Branch strategy']);
    expect(await log.getByTag('missing')).toEqual([]);
    expect(await log.getByTag('testing', 1)).toHaveLength(1);
  });

  it('getByTask filters by related task ids', async () => {
    const log = await seeded();
    expect((await log.getByTask('TASK-017')).map(d => d.title)).toEqual(['Adopt Vitest']);
    expect(await log.getByTask('TASK-999')).toEqual([]);
  });

  it('getAll honors the limit', async () => {
    const log = await seeded();
    expect(await log.getAll()).toHaveLength(3);
    expect(await log.getAll(2)).toHaveLength(2);
  });
});
