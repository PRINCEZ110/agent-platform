import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { PermissionsManager, DEFAULT_PERMISSIONS } from '../../src/safety/permissions.js';

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
});

describe('DEFAULT_PERMISSIONS invariants', () => {
  it('agent_b cannot push to git or delete files', () => {
    const b = DEFAULT_PERMISSIONS.agent_b;
    expect(b.permissions).not.toContain('git.push');
    expect(b.permissions).not.toContain('fs.delete');
    expect(b.permissions).not.toContain('fs.execute');
    expect(b.permissions).not.toContain('network.websocket');
  });

  it('both agents require approval for destructive operations', () => {
    for (const agent of ['agent_a', 'agent_b'] as const) {
      expect(DEFAULT_PERMISSIONS[agent].approvalRequired).toContain('fs.delete');
      expect(DEFAULT_PERMISSIONS[agent].approvalRequired).toContain('git.push');
      expect(DEFAULT_PERMISSIONS[agent].approvalRequired).toContain('process.spawn');
    }
  });

  it('agent_b is scoped to its own workspace paths', () => {
    const limits = DEFAULT_PERMISSIONS.agent_b.resourceLimits;
    expect(limits.allowedPaths).toEqual([
      'src/agents/specialist/**',
      'tests/**',
      'docs/**',
      'examples/**',
      'scripts/**'
    ]);
    for (const owned of ['src/core/**', 'src/comm/**', 'src/tasks/**', 'src/agents/lead/**']) {
      expect(limits.deniedPaths).toContain(owned);
    }
  });

  it('denies dangerous commands and paths for both agents', () => {
    for (const agent of ['agent_a', 'agent_b'] as const) {
      const limits = DEFAULT_PERMISSIONS[agent].resourceLimits;
      expect(limits.deniedPaths).toContain('**/node_modules/**');
      expect(limits.deniedPaths).toContain('**/.git/**');
      expect(limits.deniedCommands.some((c: string) => c.includes('rm -rf'))).toBe(true);
    }
  });

  it('agent_b has tighter resource limits than agent_a', () => {
    const a = DEFAULT_PERMISSIONS.agent_a.resourceLimits;
    const b = DEFAULT_PERMISSIONS.agent_b.resourceLimits;
    expect(b.maxFileSize).toBeLessThan(a.maxFileSize);
    expect(b.maxConcurrentTools).toBeLessThan(a.maxConcurrentTools);
    expect(b.maxExecutionTime).toBeLessThan(a.maxExecutionTime);
  });
});

describe('PermissionsManager', () => {
  it('falls back to defaults and persists them when no config exists', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();

    const result = await manager.initialize();

    expect(result.ok).toBe(true);
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(manager.getPermissions('agent_a')).toEqual(DEFAULT_PERMISSIONS.agent_a);
    expect(manager.getPermissions('agent_b')).toEqual(DEFAULT_PERMISSIONS.agent_b);
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it('loads custom permissions from disk when present', async () => {
    const custom = { ...DEFAULT_PERMISSIONS.agent_b, permissions: ['fs.read'] };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(custom) as never);
    const manager = new PermissionsManager();
    await manager.initialize();

    expect(manager.hasPermission('agent_b', 'fs.read')).toBe(true);
    expect(manager.hasPermission('agent_b', 'fs.write')).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('hasPermission is false for unknown agents', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();
    expect(manager.hasPermission('ghost', 'fs.read')).toBe(false);
  });

  it('requiresApproval fails safe (true) for unknown agents', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();
    expect(manager.requiresApproval('ghost', 'fs.read')).toBe(true);
    expect(manager.requiresApproval('agent_a', 'git.push')).toBe(true);
    expect(manager.requiresApproval('agent_a', 'terminal.exec')).toBe(false);
  });

  it('checkResourceLimits enforces numeric maxima', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();

    expect(manager.checkResourceLimits('agent_b', 'maxFileSize', 1024)).toBe(true);
    expect(manager.checkResourceLimits('agent_b', 'maxFileSize', 6 * 1024 * 1024)).toBe(false);
    expect(manager.checkResourceLimits('agent_b', 'maxConcurrentTools', 10)).toBe(false);
  });

  it('checkResourceLimits checks membership for array limits', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();

    expect(manager.checkResourceLimits('agent_b', 'allowedCommands', 'npm')).toBe(true);
    expect(manager.checkResourceLimits('agent_b', 'allowedCommands', 'curl')).toBe(false);
  });

  it('grantPermission adds and persists a permission', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();
    vi.mocked(writeFile).mockClear();

    const result = await manager.grantPermission('agent_b', 'git.push');

    expect(result.ok).toBe(true);
    expect(manager.hasPermission('agent_b', 'git.push')).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('grantPermission on an already-granted permission does not rewrite the file', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();
    vi.mocked(writeFile).mockClear();

    const result = await manager.grantPermission('agent_b', 'fs.read');

    expect(result.ok).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('grantPermission fails for unknown agents', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();

    const result = await manager.grantPermission('ghost', 'fs.read');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('SafetyError');
  });

  it('revokePermission removes and persists', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();
    vi.mocked(writeFile).mockClear();

    const result = await manager.revokePermission('agent_b', 'terminal.exec');

    expect(result.ok).toBe(true);
    expect(manager.hasPermission('agent_b', 'terminal.exec')).toBe(false);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('revokePermission fails for unknown agents', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();
    const result = await manager.revokePermission('ghost', 'fs.read');
    expect(result.ok).toBe(false);
  });

  it('setResourceLimit updates and persists a limit', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const manager = new PermissionsManager();
    await manager.initialize();

    const result = await manager.setResourceLimit('agent_b', 'maxFileSize', 1024);

    expect(result.ok).toBe(true);
    expect(manager.checkResourceLimits('agent_b', 'maxFileSize', 2048)).toBe(false);
  });

  it('savePermissions errors when the agent is unknown', async () => {
    const manager = new PermissionsManager();
    const result = await manager.savePermissions('ghost');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Permissions not found');
  });
});
