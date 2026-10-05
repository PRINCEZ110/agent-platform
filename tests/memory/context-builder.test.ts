import { describe, it, expect, vi } from 'vitest';
import { ContextBuilder } from '../../src/memory/context-builder.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
import { CodebaseIndexer } from '../../src/memory/codebase-indexer.js';
import { DecisionLog } from '../../src/memory/decision-log.js';
import { TaskContext } from '../../src/agents/interfaces/agent-interface.js';

const task: TaskContext = {
  taskId: 'TASK-017',
  title: 'Write unit tests',
  description: 'Cover all modules',
  files: ['tests/obs/metrics.test.ts'],
  dependencies: [],
  priority: 'high',
  context: {}
};

interface Deps {
  builder: ContextBuilder;
  memory: { getAllKeys: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  indexer: { search: ReturnType<typeof vi.fn>; getIndexedFiles: ReturnType<typeof vi.fn> };
  decisions: { search: ReturnType<typeof vi.fn> };
}

function makeDeps(): Deps {
  const memory = {
    getAllKeys: vi.fn(async () => [] as string[]),
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined)
  };
  const indexer = {
    search: vi.fn(async () => [] as Array<{ file: string; content: string; score: number }>),
    getIndexedFiles: vi.fn(() => [] as string[])
  };
  const decisions = {
    search: vi.fn(async () => [] as Array<{ id: string; title: string; decision: string; rationale: string }>)
  };
  return {
    builder: new ContextBuilder(
      memory as unknown as MemoryStore,
      indexer as unknown as CodebaseIndexer,
      decisions as unknown as DecisionLog
    ),
    memory,
    indexer,
    decisions
  };
}

describe('ContextBuilder.buildContext', () => {
  it('queries indexer and decisions with the composed task query', async () => {
    const deps = makeDeps();
    deps.indexer.search.mockResolvedValue([{ file: 'src/a.ts', content: 'code', score: 3 }]);
    deps.decisions.search.mockResolvedValue([
      { id: 'dec-1', title: 'T', decision: 'D', rationale: 'R' }
    ]);

    const result = await deps.builder.buildContext(task);

    expect(result.ok).toBe(true);
    const expectedQuery = 'Write unit tests Cover all modules tests/obs/metrics.test.ts';
    expect(deps.indexer.search).toHaveBeenCalledWith(expectedQuery, 10);
    expect(deps.decisions.search).toHaveBeenCalledWith(expectedQuery, undefined, 5);

    if (result.ok) {
      expect(result.value.task).toBe(task);
      expect(result.value.relevantCode).toEqual([{ file: 'src/a.ts', content: 'code', score: 3 }]);
      expect(result.value.relevantDecisions).toEqual([{ id: 'dec-1', title: 'T', decision: 'D', rationale: 'R' }]);
      expect(result.value.timestamp).toBeInstanceOf(Date);
    }
  });

  it('honors maxCodeResults and maxDecisions options', async () => {
    const deps = makeDeps();
    await deps.builder.buildContext(task, { maxCodeResults: 2, maxDecisions: 1 });
    expect(deps.indexer.search).toHaveBeenCalledWith(expect.any(String), 2);
    expect(deps.decisions.search).toHaveBeenCalledWith(expect.any(String), undefined, 1);
  });

  it('collects memory entries whose keys match the task id or task files', async () => {
    const deps = makeDeps();
    deps.memory.getAllKeys.mockResolvedValue([
      'notes-TASK-017',
      'prefix-tests/obs/metrics.test.ts-suffix',
      'unrelated-key',
      'expired-TASK-017'
    ]);
    deps.memory.get.mockImplementation(async (key: string) =>
      key === 'expired-TASK-017' ? undefined : `value-for-${key}`
    );

    const result = await deps.builder.buildContext(task);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.memory).toEqual({
        'notes-TASK-017': 'value-for-notes-TASK-017',
        'prefix-tests/obs/metrics.test.ts-suffix': 'value-for-prefix-tests/obs/metrics.test.ts-suffix'
      });
    }
    expect(deps.memory.get).not.toHaveBeenCalledWith('unrelated-key');
  });

  it('defaults agent preferences to {} and project structure to ""', async () => {
    const deps = makeDeps();
    const result = await deps.builder.buildContext(task);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agentPreferences).toEqual({});
      expect(result.value.projectStructure).toBe('');
    }
  });

  it('passes through agent preferences and project structure from memory', async () => {
    const deps = makeDeps();
    deps.memory.get.mockImplementation(async (key: string) => {
      if (key === 'agent:preferences') return { style: 'concise' };
      if (key === 'project:structure') return '{"src":{}}';
      return undefined;
    });

    const result = await deps.builder.buildContext(task);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agentPreferences).toEqual({ style: 'concise' });
      expect(result.value.projectStructure).toBe('{"src":{}}');
    }
  });
});

describe('ContextBuilder.updateProjectStructure', () => {
  it('builds a JSON tree from indexed files and stores it', async () => {
    const deps = makeDeps();
    deps.indexer.getIndexedFiles.mockReturnValue(['src/a/b.ts', 'src/c.ts', 'root.ts']);

    await deps.builder.updateProjectStructure();

    expect(deps.memory.set).toHaveBeenCalledTimes(1);
    const [key, value] = deps.memory.set.mock.calls[0];
    expect(key).toBe('project:structure');
    expect(JSON.parse(value as string)).toEqual({
      src: { a: { 'b.ts': null }, 'c.ts': null },
      'root.ts': null
    });
  });

  it('stores an empty object tree when nothing is indexed', async () => {
    const deps = makeDeps();
    deps.indexer.getIndexedFiles.mockReturnValue([]);

    await deps.builder.updateProjectStructure();

    const [, value] = deps.memory.set.mock.calls[0];
    expect(JSON.parse(value as string)).toEqual({});
  });
});
