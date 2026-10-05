import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { PermissionChecker, permissionChecker } from '../../src/safety/checker.js';
import { DEFAULT_PERMISSIONS } from '../../src/safety/permissions.js';

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
  vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
});

describe('PermissionChecker.check', () => {
  const checker = new PermissionChecker();

  it('allows a permission the agent holds', async () => {
    const result = await checker.check('agent_b', ['fs.read']);
    expect(result.ok).toBe(true);
  });

  it('allows multiple held permissions', async () => {
    const result = await checker.check('agent_a', ['fs.read', 'fs.delete', 'git.push']);
    expect(result.ok).toBe(true);
  });

  it('denies fs.delete for agent_b', async () => {
    const result = await checker.check('agent_b', ['fs.delete']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe('SafetyError');
      expect(result.error.message).toContain('Permission denied: fs.delete');
    }
  });

  it('denies git.push for agent_b', async () => {
    const result = await checker.check('agent_b', ['git.push']);
    expect(result.ok).toBe(false);
  });

  it('denies everything for an unknown agent', async () => {
    const result = await checker.check('ghost', ['fs.read']);
    expect(result.ok).toBe(false);
  });

  it('denies network.websocket for agent_b (not in its set)', async () => {
    const result = await checker.check('agent_b', ['network.websocket']);
    expect(result.ok).toBe(false);
  });

  it('initializes the shared permissions manager from defaults', async () => {
    await checker.check('agent_b', ['fs.read']);
    expect(mkdir).toHaveBeenCalled();
    expect(vi.mocked(writeFile).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PermissionChecker.checkAndRequireApproval', () => {
  const checker = new PermissionChecker();

  it('reports which held permissions need approval', async () => {
    const result = await checker.checkAndRequireApproval('agent_a', ['terminal.exec', 'git.push', 'fs.delete']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sort()).toEqual(['fs.delete', 'git.push']);
  });

  it('returns an empty approval list when nothing needs approval', async () => {
    const result = await checker.checkAndRequireApproval('agent_a', ['fs.read', 'terminal.exec']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('fails when a permission is missing entirely', async () => {
    const result = await checker.checkAndRequireApproval('agent_b', ['fs.read', 'fs.delete']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Missing permissions: fs.delete');
  });

  it('lists all missing permissions in the error', async () => {
    const result = await checker.checkAndRequireApproval('agent_b', ['git.push', 'fs.delete']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('git.push');
    if (!result.ok) expect(result.error.message).toContain('fs.delete');
  });
});

describe('PermissionChecker.checkResourceLimit', () => {
  const checker = new PermissionChecker();

  it('accepts a value within the numeric limit', async () => {
    const result = await checker.checkResourceLimit('agent_b', 'maxFileSize', 1024);
    expect(result.ok).toBe(true);
  });

  it('rejects a value above the numeric limit', async () => {
    const over = DEFAULT_PERMISSIONS.agent_b.resourceLimits.maxFileSize + 1;
    const result = await checker.checkResourceLimit('agent_b', 'maxFileSize', over);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Resource limit exceeded: maxFileSize');
  });

  it('rejects exceeding maxConcurrentTools', async () => {
    const result = await checker.checkResourceLimit('agent_b', 'maxConcurrentTools', 99);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown agent (no limits configured)', async () => {
    const result = await checker.checkResourceLimit('ghost', 'maxFileSize', 1);
    expect(result.ok).toBe(false);
  });
});

describe('permissionChecker singleton', () => {
  it('is exported and functional', async () => {
    const result = await permissionChecker.check('agent_b', ['fs.read']);
    expect(result.ok).toBe(true);
  });
});
