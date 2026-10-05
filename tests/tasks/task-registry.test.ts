import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import { TaskRegistry, Task } from '../../src/tasks/task-registry.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

type TaskSeed = Partial<Task> & { task_id: string };

const seed = (overrides: TaskSeed): Record<string, unknown> => ({
  owner: 'agent_b',
  description: 'desc',
  status: 'PLANNED',
  files: [],
  dependencies: [],
  expected_output: 'output',
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  ...overrides
});

async function loadedRegistry(tasks: TaskSeed[]): Promise<TaskRegistry> {
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({ tasks: tasks.map(seed) }) as never);
  const registry = new TaskRegistry();
  const result = await registry.load();
  expect(result.ok).toBe(true);
  vi.mocked(writeFile).mockClear();
  return registry;
}

const newTaskInput = (id: string, overrides: Partial<Task> = {}) =>
  ({
    owner: 'agent_b',
    description: 'desc',
    status: 'PLANNED',
    files: [],
    dependencies: [],
    expected_output: 'output',
    ...overrides,
    task_id: id
  }) as Omit<Task, 'createdAt' | 'updatedAt'>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('TaskRegistry.load / save', () => {
  it('loads tasks and converts date strings to Date objects', async () => {
    const registry = await loadedRegistry([{ task_id: 'T1' }]);
    const task = registry.getTask('T1');
    expect(task).toBeDefined();
    expect(task!.createdAt).toBeInstanceOf(Date);
    expect(task!.updatedAt).toBeInstanceOf(Date);
  });

  it('returns a TaskError result when the registry file is unreadable', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const registry = new TaskRegistry();
    const result = await registry.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe('TaskError');
      expect(result.error.message).toContain('Failed to load tasks');
    }
  });

  it('save writes the registry to active-tasks.json', async () => {
    const registry = await loadedRegistry([]);
    const result = await registry.save();
    expect(result.ok).toBe(true);
    expect(vi.mocked(writeFile).mock.calls[0][0]).toContain('active-tasks.json');
    expect(vi.mocked(writeFile).mock.calls[0][1]).toContain('"tasks"');
  });
});

describe('TaskRegistry.createTask', () => {
  it('creates a task with timestamps and persists it', async () => {
    const registry = await loadedRegistry([]);
    const result = await registry.createTask(newTaskInput('TASK-020'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.task_id).toBe('TASK-020');
      expect(result.value.createdAt).toBeInstanceOf(Date);
      expect(result.value.updatedAt).toBeInstanceOf(Date);
    }
    expect(registry.getTask('TASK-020')).toBeDefined();
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate task id without writing', async () => {
    const registry = await loadedRegistry([{ task_id: 'TASK-020' }]);
    const result = await registry.createTask(newTaskInput('TASK-020'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('already exists');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.skip('validates required fields at runtime (GAP-001: no Zod validation in TaskRegistry yet)', () => {
    const registry = new TaskRegistry();
    // registry.createTask({ task_id: 'X' } as any) should return err(ValidationError)
  });
});

describe('TaskRegistry.updateTask / setStatus', () => {
  it('returns an error for an unknown task id', async () => {
    const registry = await loadedRegistry([]);
    const result = await registry.updateTask('NOPE', { status: 'IN_PROGRESS' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Task not found');
  });

  it('sets startedAt when moving to IN_PROGRESS and keeps it stable', async () => {
    const registry = await loadedRegistry([{ task_id: 'T1' }]);

    const first = await registry.setStatus('T1', 'IN_PROGRESS');
    expect(first.ok).toBe(true);
    const startedAt = registry.getTask('T1')!.startedAt;
    expect(startedAt).toBeInstanceOf(Date);

    await registry.setStatus('T1', 'REVIEW');
    expect(registry.getTask('T1')!.startedAt).toEqual(startedAt);
  });

  it('sets completedAt when moving to COMPLETED', async () => {
    const registry = await loadedRegistry([{ task_id: 'T1' }]);
    await registry.setStatus('T1', 'IN_PROGRESS');
    await registry.setStatus('T1', 'COMPLETED');

    const task = registry.getTask('T1')!;
    expect(task.status).toBe('COMPLETED');
    expect(task.completedAt).toBeInstanceOf(Date);
    expect(task.startedAt).toBeInstanceOf(Date);
  });

  it('does not set startedAt for non-IN_PROGRESS transitions', async () => {
    const registry = await loadedRegistry([{ task_id: 'T1' }]);
    await registry.setStatus('T1', 'BLOCKED');
    expect(registry.getTask('T1')!.startedAt).toBeUndefined();
  });

  it('persists updates on every status change', async () => {
    const registry = await loadedRegistry([{ task_id: 'T1' }]);
    await registry.setStatus('T1', 'IN_PROGRESS');
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe('TaskRegistry dependencies', () => {
  it('resolves known dependencies and drops missing ones', async () => {
    const registry = await loadedRegistry([
      { task_id: 'T1', dependencies: ['D1', 'D-MISSING'] },
      { task_id: 'D1' }
    ]);
    const deps = registry.getDependencies('T1');
    expect(deps.map(d => d.task_id)).toEqual(['D1']);
    expect(registry.getDependencies('NOPE')).toEqual([]);
  });

  it('finds dependents of a task', async () => {
    const registry = await loadedRegistry([
      { task_id: 'T1', dependencies: ['D1'] },
      { task_id: 'T2', dependencies: ['D1'] },
      { task_id: 'D1' }
    ]);
    expect(registry.getDependents('D1').map(t => t.task_id).sort()).toEqual(['T1', 'T2']);
    expect(registry.getDependents('NOPE')).toEqual([]);
  });

  it('canStart requires PLANNED/READY status and all dependencies COMPLETED', async () => {
    const registry = await loadedRegistry([
      { task_id: 'READY_NODEP' },
      { task_id: 'PLANNED_WAITING', dependencies: ['D1'] },
      { task_id: 'PLANNED_DONE', dependencies: ['D2'] },
      { task_id: 'IN_PROGRESS', status: 'IN_PROGRESS' },
      { task_id: 'D1', status: 'PLANNED' },
      { task_id: 'D2', status: 'COMPLETED' }
    ]);

    expect(registry.canStart('READY_NODEP')).toBe(true);
    expect(registry.canStart('PLANNED_WAITING')).toBe(false);
    expect(registry.canStart('PLANNED_DONE')).toBe(true);
    expect(registry.canStart('IN_PROGRESS')).toBe(false);
    expect(registry.canStart('UNKNOWN')).toBe(false);
  });

  it('getReadyTasks filters by canStart and optional owner', async () => {
    const registry = await loadedRegistry([
      { task_id: 'A1' },
      { task_id: 'A2', owner: 'agent_a' },
      { task_id: 'A3', dependencies: ['A1'] },
      { task_id: 'A4', dependencies: ['B1'] },
      { task_id: 'B1', status: 'PLANNED' }
    ]);

    const mine = registry.getReadyTasks('agent_b');
    expect(mine.map(t => t.task_id).sort()).toEqual(['A1', 'B1']);

    const all = registry.getReadyTasks();
    expect(all.map(t => t.task_id).sort()).toEqual(['A1', 'A2', 'B1']);
  });
});

describe('TaskRegistry queries and delete', () => {
  it('filters by owner and status', async () => {
    const registry = await loadedRegistry([
      { task_id: 'T1', owner: 'agent_b', status: 'COMPLETED' },
      { task_id: 'T2', owner: 'agent_a', status: 'PLANNED' }
    ]);
    expect(registry.getTasksByOwner('agent_b').map(t => t.task_id)).toEqual(['T1']);
    expect(registry.getTasksByStatus('PLANNED').map(t => t.task_id)).toEqual(['T2']);
    expect(registry.getAllTasks()).toHaveLength(2);
  });

  it('deletes an existing task and persists', async () => {
    const registry = await loadedRegistry([{ task_id: 'T1' }]);
    const result = await registry.deleteTask('T1');
    expect(result.ok).toBe(true);
    expect(registry.getTask('T1')).toBeUndefined();
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('returns an error when deleting an unknown task', async () => {
    const registry = await loadedRegistry([]);
    const result = await registry.deleteTask('NOPE');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Task not found');
    expect(writeFile).not.toHaveBeenCalled();
  });
});
