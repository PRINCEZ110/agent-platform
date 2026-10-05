import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import { OwnershipRegistry, OwnershipConfig } from '../../src/tasks/ownership-registry.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

const fixture: OwnershipConfig = {
  agent_a: { description: 'lead', files: ['src/core/**', 'src/comm/**', 'package.json'] },
  agent_b: { description: 'specialist', files: ['tests/**', 'src/agents/specialist/**', 'docs/**'] },
  shared: { description: 'shared', files: ['AGENTS.md', '.ai/**', 'src/agents/base/**'] }
};

async function loaded(): Promise<OwnershipRegistry> {
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(fixture) as never);
  const registry = new OwnershipRegistry();
  const result = await registry.load();
  expect(result.ok).toBe(true);
  vi.mocked(writeFile).mockClear();
  return registry;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('OwnershipRegistry.load', () => {
  it('parses the ownership config', async () => {
    const registry = await loaded();
    expect(registry.getConfig()).toEqual(fixture);
    expect(vi.mocked(readFile).mock.calls[0][0]).toContain('ownership.json');
  });

  it('returns a TaskError result when the file is unreadable', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const registry = new OwnershipRegistry();
    const result = await registry.load();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('TaskError');
    expect(registry.getConfig()).toBeNull();
  });
});

describe('OwnershipRegistry.getOwner', () => {
  it('is unknown before a config is loaded', () => {
    expect(new OwnershipRegistry().getOwner('src/core/x.ts')).toBe('unknown');
  });

  it('resolves glob patterns for each owner', async () => {
    const registry = await loaded();
    expect(registry.getOwner('src/core/types.ts')).toBe('agent_a');
    expect(registry.getOwner('src/comm/message-bus.ts')).toBe('agent_a');
    expect(registry.getOwner('tests/comm/messages.test.ts')).toBe('agent_b');
    expect(registry.getOwner('src/agents/specialist/agent.ts')).toBe('agent_b');
    expect(registry.getOwner('AGENTS.md')).toBe('shared');
    expect(registry.getOwner('.ai/active-tasks.json')).toBe('shared');
    expect(registry.getOwner('src/agents/base/base-agent.ts')).toBe('shared');
  });

  it('returns unknown for files matched by no pattern', async () => {
    const registry = await loaded();
    expect(registry.getOwner('secrets.env')).toBe('unknown');
    expect(registry.getOwner('src/ui/app.tsx')).toBe('unknown');
  });

  it('checks agent_a patterns before agent_b (precedence rule)', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        agent_a: { description: '', files: ['overlap/**'] },
        agent_b: { description: '', files: ['overlap/**'] },
        shared: { description: '', files: [] }
      }) as never
    );
    const registry = new OwnershipRegistry();
    await registry.load();
    expect(registry.getOwner('overlap/file.ts')).toBe('agent_a');
  });
});

describe('OwnershipRegistry.canModify', () => {
  it('allows only the owner', async () => {
    const registry = await loaded();
    expect(registry.canModify('agent_a', 'src/core/types.ts')).toBe(true);
    expect(registry.canModify('agent_b', 'tests/a.test.ts')).toBe(true);
    expect(registry.canModify('agent_b', 'src/core/types.ts')).toBe(false);
    expect(registry.canModify('agent_a', 'tests/a.test.ts')).toBe(false);
  });

  it('denies shared files (requires coordination) and unknown files (default deny)', async () => {
    const registry = await loaded();
    expect(registry.canModify('agent_a', 'AGENTS.md')).toBe(false);
    expect(registry.canModify('agent_b', '.ai/ownership.json')).toBe(false);
    expect(registry.canModify('agent_a', 'no/mans/land')).toBe(false);
  });

  it('denies everything without a loaded config', () => {
    expect(new OwnershipRegistry().canModify('agent_a', 'src/core/x.ts')).toBe(false);
  });
});

describe('OwnershipRegistry listings', () => {
  it('returns owned and shared pattern lists', async () => {
    const registry = await loaded();
    expect(registry.getOwnedFiles('agent_b')).toEqual(fixture.agent_b.files);
    expect(registry.getSharedFiles()).toEqual(fixture.shared.files);
  });

  it('returns empty lists without a config', () => {
    const registry = new OwnershipRegistry();
    expect(registry.getOwnedFiles('agent_a')).toEqual([]);
    expect(registry.getSharedFiles()).toEqual([]);
  });
});

describe('OwnershipRegistry.updateConfig', () => {
  it('persists the new config and applies it in memory', async () => {
    const registry = await loaded();
    const next: OwnershipConfig = {
      agent_a: { description: 'a', files: ['only/a/**'] },
      agent_b: { description: 'b', files: ['only/b/**'] },
      shared: { description: 's', files: [] }
    };

    const result = await registry.updateConfig(next);

    expect(result.ok).toBe(true);
    expect(vi.mocked(writeFile).mock.calls[0][0]).toContain('ownership.json');
    expect(registry.getOwner('only/a/x.ts')).toBe('agent_a');
    expect(registry.getOwner('src/core/x.ts')).toBe('unknown');
  });

  it('returns a TaskError result when the write fails', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('read-only fs') as never);
    const registry = new OwnershipRegistry();
    const result = await registry.updateConfig(fixture);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('TaskError');
  });
});

describe('OwnershipRegistry.validateFileAccess', () => {
  it('splits a batch into allowed and denied files', async () => {
    const registry = await loaded();
    const result = registry.validateFileAccess('agent_b', [
      'tests/a.test.ts',
      'src/core/types.ts',
      'AGENTS.md',
      'src/agents/specialist/x.ts',
      'random.txt'
    ]);

    expect(result.allowed).toEqual(['tests/a.test.ts', 'src/agents/specialist/x.ts']);
    expect(result.denied).toEqual(['src/core/types.ts', 'AGENTS.md', 'random.txt']);
  });

  it('denies everything when no config is loaded', () => {
    const result = new OwnershipRegistry().validateFileAccess('agent_a', ['src/core/x.ts']);
    expect(result.allowed).toEqual([]);
    expect(result.denied).toEqual(['src/core/x.ts']);
  });
});
