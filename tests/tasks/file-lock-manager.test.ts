import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdir, readFile, readdir, writeFile, rm } from 'fs/promises';
import { FileLockManager } from '../../src/tasks/file-lock-manager.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

const T0 = new Date('2026-10-05T10:00:00.000Z');

async function freshManager(): Promise<FileLockManager> {
  vi.mocked(readdir).mockResolvedValue([] as never);
  const manager = new FileLockManager();
  const result = await manager.initialize();
  expect(result.ok).toBe(true);
  return manager;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

describe('FileLockManager.initialize', () => {
  it('creates the locks directory and reports ok', async () => {
    await freshManager();
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(mkdir).mock.calls[0][0])).toContain('.ai');
  });

  it('hydrates existing lock files from disk', async () => {
    vi.mocked(readdir).mockResolvedValue(['src_a.ts.lock'] as never);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        file: 'src/a.ts',
        taskId: 'TASK-001',
        agentId: 'agent_a',
        acquiredAt: T0.toISOString(),
        expiresAt: new Date(T0.getTime() + 3600000).toISOString()
      }) as never
    );

    const manager = new FileLockManager();
    await manager.initialize();

    expect(manager.isLocked('src/a.ts')).toBe(true);
    expect(manager.getLock('src/a.ts')!.agentId).toBe('agent_a');
  });

  it('ignores non-lock files in the locks directory', async () => {
    vi.mocked(readdir).mockResolvedValue(['.gitkeep', 'notes.txt'] as never);
    const manager = new FileLockManager();
    await manager.initialize();
    expect(manager.getLocksByAgent('agent_a')).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('FileLockManager.acquire', () => {
  it('acquires a fresh lock and persists it with a sanitised file name', async () => {
    const manager = await freshManager();
    const result = await manager.acquire('src/app/main.ts', 'TASK-020', 'agent_b');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agentId).toBe('agent_b');
      expect(result.value.taskId).toBe('TASK-020');
      expect(result.value.acquiredAt).toBeInstanceOf(Date);
    }
    expect(vi.mocked(writeFile).mock.calls[0][0]).toContain('src_app_main.ts.lock');
    expect(manager.isLocked('src/app/main.ts')).toBe(true);
  });

  it('rejects a conflicting claim from another agent/task', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a');

    const result = await manager.acquire('src/a.ts', 'TASK-002', 'agent_b');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('locked by agent_a');
      expect(result.error.message).toContain('TASK-001');
    }
  });

  it('is re-entrant for the same agent and task', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a');
    const again = await manager.acquire('src/a.ts', 'TASK-001', 'agent_a');
    expect(again.ok).toBe(true);
  });

  it('steals an expired lock', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a', 1000);

    vi.setSystemTime(new Date(T0.getTime() + 5000));

    const result = await manager.acquire('src/a.ts', 'TASK-002', 'agent_b');
    expect(result.ok).toBe(true);
    expect(manager.getLock('src/a.ts')!.agentId).toBe('agent_b');
  });
});

describe('FileLockManager.release', () => {
  it('releases a lock owned by the caller and removes the file', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a');

    const result = await manager.release('src/a.ts', 'TASK-001', 'agent_a');

    expect(result.ok).toBe(true);
    expect(manager.isLocked('src/a.ts')).toBe(false);
    expect(rm).toHaveBeenCalledTimes(1);
  });

  it('rejects release by a different owner', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a');

    const result = await manager.release('src/a.ts', 'TASK-002', 'agent_b');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Cannot release lock owned by agent_a');
    expect(manager.isLocked('src/a.ts')).toBe(true);
    expect(rm).not.toHaveBeenCalled();
  });

  it('treats releasing an unknown lock as a no-op success', async () => {
    const manager = await freshManager();
    const result = await manager.release('nope.ts', 'TASK-001', 'agent_a');
    expect(result.ok).toBe(true);
  });

  it('forceRelease removes any lock regardless of owner', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a');
    const result = await manager.forceRelease('src/a.ts');
    expect(result.ok).toBe(true);
    expect(manager.isLocked('src/a.ts')).toBe(false);
  });
});

describe('FileLockManager expiry', () => {
  it('isLocked becomes false once the TTL passes', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a', 1000);
    expect(manager.isLocked('src/a.ts')).toBe(true);

    vi.setSystemTime(new Date(T0.getTime() + 1001));

    expect(manager.isLocked('src/a.ts')).toBe(false);
    expect(manager.getLock('src/a.ts')).toBeUndefined();
  });

  it('cleanup removes only expired locks', async () => {
    const manager = await freshManager();
    await manager.acquire('short.ts', 'TASK-001', 'agent_a', 1000);
    await manager.acquire('long.ts', 'TASK-001', 'agent_a', 3600000);

    vi.setSystemTime(new Date(T0.getTime() + 2000));

    const cleaned = await manager.cleanup();

    expect(cleaned).toBe(1);
    expect(manager.isLocked('short.ts')).toBe(false);
    expect(manager.isLocked('long.ts')).toBe(true);
  });
});

describe('FileLockManager.extend', () => {
  it('extends an owned lock and persists the new expiry', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a', 1000);
    const before = manager.getLock('src/a.ts')!.expiresAt!.getTime();

    vi.setSystemTime(new Date(T0.getTime() + 500));

    const result = await manager.extend('src/a.ts', 'TASK-001', 'agent_a', 60000);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.expiresAt!.getTime()).toBeGreaterThan(before);
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it('rejects extending a lock owned by someone else', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a');

    const result = await manager.extend('src/a.ts', 'TASK-002', 'agent_b');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Cannot extend lock owned by agent_a');
  });

  it('rejects extending a lock that does not exist', async () => {
    const manager = await freshManager();
    const result = await manager.extend('nope.ts', 'TASK-001', 'agent_a');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('No lock to extend');
  });
});

describe('FileLockManager queries', () => {
  it('queries locks by task and by agent', async () => {
    const manager = await freshManager();
    await manager.acquire('src/a.ts', 'TASK-001', 'agent_a');
    await manager.acquire('src/b.ts', 'TASK-002', 'agent_b');

    expect(manager.getLocksByTask('TASK-001').map(l => l.file)).toEqual(['src/a.ts']);
    expect(manager.getLocksByAgent('agent_b').map(l => l.file)).toEqual(['src/b.ts']);
    expect(manager.getLocksByTask('TASK-999')).toEqual([]);
  });
});
