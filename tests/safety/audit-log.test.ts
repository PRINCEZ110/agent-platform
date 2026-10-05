import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { AuditLog } from '../../src/safety/audit-log.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

const entry = (over: Record<string, unknown> = {}) => ({
  agentId: 'agent_b',
  action: 'tool.execute',
  resource: 'tests/a.test.ts',
  permissions: ['fs.read'],
  outcome: 'success' as const,
  details: {},
  riskLevel: 'low' as const,
  ...over
});

const fileEntry = (over: Record<string, unknown> = {}) => JSON.stringify(entry(over));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('AuditLog.initialize', () => {
  it('creates the audit directory and starts empty when nothing exists', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
    const log = new AuditLog();
    const result = await log.initialize();
    expect(result.ok).toBe(true);
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(await log.query()).toEqual([]);
  });

  it('hydrates existing entries and converts timestamps to Date', async () => {
    vi.mocked(readdir).mockResolvedValue(['e2.json', 'e1.json'] as never);
    vi.mocked(readFile)
      .mockResolvedValueOnce(fileEntry({ action: 'second', timestamp: '2026-10-05T12:00:00.000Z' }) as never)
      .mockResolvedValueOnce(fileEntry({ action: 'first', timestamp: '2026-10-05T08:00:00.000Z' }) as never);

    const log = new AuditLog();
    await log.initialize();
    const results = await log.query();

    expect(results).toHaveLength(2);
    expect(results[0].action).toBe('second');
    expect(results[1].timestamp).toBeInstanceOf(Date);
  });

  it('returns a SafetyError result when initialization fails hard', async () => {
    vi.mocked(mkdir).mockRejectedValue(new Error('EACCES') as never);
    const log = new AuditLog();
    const result = await log.initialize();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('SafetyError');
  });
});

describe('AuditLog.log', () => {
  it('records an entry with id/timestamp and persists it under a date folder', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
    const log = new AuditLog();
    await log.initialize();
    vi.mocked(writeFile).mockClear();
    vi.mocked(mkdir).mockClear();

    const result = await log.log(entry());

    expect(result.ok).toBe(true);
    const results = await log.query();
    expect(results).toHaveLength(1);
    expect(results[0].id).toMatch(/^audit-/);
    expect(results[0].timestamp).toBeInstanceOf(Date);
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(mkdir).mock.calls[0][0])).toMatch(/\d{4}-\d{2}-\d{2}$/);
    expect(String(vi.mocked(writeFile).mock.calls[0][0])).toContain('.json');
  });

  it('returns a SafetyError result when persisting fails', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
    const log = new AuditLog();
    await log.initialize();
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full') as never);

    const result = await log.log(entry());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('SafetyError');
    const results = await log.query();
    expect(results).toHaveLength(1);
  });
});

describe('AuditLog.query', () => {
  async function seeded(): Promise<AuditLog> {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
    const log = new AuditLog();
    await log.initialize();
    await log.log(entry({ agentId: 'agent_a', action: 'git.commit', outcome: 'success', riskLevel: 'low' }) as never);
    await log.log(entry({ agentId: 'agent_b', action: 'tool.execute', outcome: 'denied', riskLevel: 'high', permissions: ['fs.delete'] }) as never);
    await log.log(entry({ agentId: 'agent_b', action: 'tool.execute', outcome: 'error', riskLevel: 'critical', permissions: ['git.push'] }) as never);
    return log;
  }

  it('filters by agentId', async () => {
    const log = await seeded();
    const results = await log.query({ agentId: 'agent_b' });
    expect(results).toHaveLength(2);
    expect(results.every(r => r.agentId === 'agent_b')).toBe(true);
  });

  it('filters by action and outcome', async () => {
    const log = await seeded();
    expect(await log.query({ action: 'git.commit' })).toHaveLength(1);
    expect(await log.query({ outcome: 'denied' })).toHaveLength(1);
    expect(await log.query({ outcome: 'success' })).toHaveLength(1);
  });

  it('filters by risk level', async () => {
    const log = await seeded();
    expect(await log.query({ riskLevel: 'critical' })).toHaveLength(1);
    expect(await log.query({ riskLevel: 'high' })).toHaveLength(1);
    expect(await log.query({ riskLevel: 'medium' })).toHaveLength(0);
  });

  it('filters by time window and returns newest first', async () => {
    vi.mocked(readdir).mockResolvedValue(['old.json', 'new.json'] as never);
    vi.mocked(readFile)
      .mockResolvedValueOnce(fileEntry({ action: 'old', timestamp: '2026-10-05T08:00:00.000Z' }) as never)
      .mockResolvedValueOnce(fileEntry({ action: 'new', timestamp: '2026-10-05T12:00:00.000Z' }) as never);

    const log = new AuditLog();
    await log.initialize();

    const all = await log.query();
    expect(all[0].action).toBe('new');
    expect(all[1].action).toBe('old');

    const since = new Date('2026-10-05T10:00:00.000Z');
    expect((await log.query({ since })).map(r => r.action)).toEqual(['new']);
    expect((await log.query({ until: since })).map(r => r.action)).toEqual(['old']);
  });

  it('caps results at the limit and defaults to 100', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
    const log = new AuditLog();
    await log.initialize();
    for (let i = 0; i < 5; i++) await log.log(entry() as never);

    expect(await log.query({ limit: 2 })).toHaveLength(2);
    expect(await log.query()).toHaveLength(5);
  });
});

describe('AuditLog analytics', () => {
  async function seeded(): Promise<AuditLog> {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
    const log = new AuditLog();
    await log.initialize();
    await log.log(entry({ agentId: 'agent_b', riskLevel: 'high' }) as never);
    await log.log(entry({ agentId: 'agent_b', riskLevel: 'high' }) as never);
    await log.log(entry({ agentId: 'agent_b', riskLevel: 'low' }) as never);
    await log.log(entry({ agentId: 'agent_a', riskLevel: 'critical', action: 'git.commit' }) as never);
    return log;
  }

  it('summarizes risk levels overall and per agent', async () => {
    const log = await seeded();
    expect(await log.getRiskSummary()).toEqual({ low: 1, medium: 0, high: 2, critical: 1 });
    expect(await log.getRiskSummary('agent_b')).toEqual({ low: 1, medium: 0, high: 2, critical: 0 });
  });

  it('ranks top actions by count', async () => {
    const log = await seeded();
    expect(await log.getTopActions()).toEqual([
      { action: 'tool.execute', count: 3 },
      { action: 'git.commit', count: 1 }
    ]);
    expect(await log.getTopActions(undefined, 1)).toEqual([{ action: 'tool.execute', count: 3 }]);
  });
});
