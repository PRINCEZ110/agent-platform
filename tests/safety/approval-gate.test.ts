import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { ApprovalGate } from '../../src/safety/approval-gate.js';

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
});

async function freshGate(): Promise<ApprovalGate> {
  const gate = new ApprovalGate();
  const result = await gate.initialize();
  expect(result.ok).toBe(true);
  vi.mocked(writeFile).mockClear();
  return gate;
}

describe('ApprovalGate.request', () => {
  it('creates a pending request and persists it', async () => {
    const gate = await freshGate();

    const result = await gate.request('agent_b', 'git.push', 'git-tool', { branch: 'main' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toMatch(/^approval-/);
      expect(result.value.status).toBe('pending');
      expect(result.value.agentId).toBe('agent_b');
      expect(result.value.permission).toBe('git.push');
      expect(result.value.requestedAt).toBeInstanceOf(Date);
      expect(result.value.context).toEqual({ branch: 'main' });
    }
    expect(vi.mocked(writeFile).mock.calls[0][0]).toContain('.json');
  });

  it('returns a SafetyError result when persisting fails', async () => {
    const gate = await freshGate();
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full') as never);

    const result = await gate.request('agent_b', 'fs.delete', 'fs-tool', {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('SafetyError');
  });
});

describe('ApprovalGate decisions', () => {
  it('approves a pending request with decider and reason', async () => {
    const gate = await freshGate();
    const req = (await gate.request('agent_b', 'git.push', 'git-tool', {})).value!;

    const result = await gate.approve(req.id, 'human-owner', 'looks safe');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('approved');
      expect(result.value.decidedBy).toBe('human-owner');
      expect(result.value.reason).toBe('looks safe');
      expect(result.value.decidedAt).toBeInstanceOf(Date);
    }
  });

  it('denies a pending request', async () => {
    const gate = await freshGate();
    const req = (await gate.request('agent_b', 'fs.delete', 'fs-tool', {})).value!;

    const result = await gate.deny(req.id, 'human-owner', 'too risky');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('denied');
      expect(result.value.reason).toBe('too risky');
    }
  });

  it('rejects a second decision on an already decided request', async () => {
    const gate = await freshGate();
    const req = (await gate.request('agent_b', 'git.push', 'git-tool', {})).value!;
    await gate.approve(req.id, 'human-owner');

    const again = await gate.approve(req.id, 'human-owner');
    const denied = await gate.deny(req.id, 'human-owner');

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain('already decided');
    expect(denied.ok).toBe(false);
  });

  it('errors on unknown request ids', async () => {
    const gate = await freshGate();
    const approve = await gate.approve('approval-nope', 'human');
    const deny = await gate.deny('approval-nope', 'human');
    expect(approve.ok).toBe(false);
    expect(deny.ok).toBe(false);
    if (!approve.ok) expect(approve.error.message).toContain('not found');
  });
});

describe('ApprovalGate queries', () => {
  it('get returns undefined for unknown ids', async () => {
    const gate = await freshGate();
    expect(await gate.get('approval-nope')).toBeUndefined();
  });

  it('getPending filters by status and agent, oldest first', async () => {
    const gate = await freshGate();
    const p1 = (await gate.request('agent_b', 'git.push', 'git-tool', {})).value!;
    const p2 = (await gate.request('agent_b', 'fs.delete', 'fs-tool', {})).value!;
    const p3 = (await gate.request('agent_a', 'git.push', 'git-tool', {})).value!;
    await gate.approve(p3.id, 'human');

    const pending = await gate.getPending();
    expect(pending.map(r => r.id)).toEqual([p1.id, p2.id]);

    const onlyA = await gate.getPending('agent_a');
    expect(onlyA).toEqual([]);
  });

  it('hydrates requests from disk on initialize', async () => {
    vi.mocked(readdir).mockResolvedValue(['approval-1.json'] as never);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        id: 'approval-1',
        agentId: 'agent_b',
        permission: 'git.push',
        tool: 'git-tool',
        context: {},
        requestedAt: '2026-10-05T10:00:00.000Z',
        status: 'pending'
      }) as never
    );

    const gate = new ApprovalGate();
    await gate.initialize();

    const loaded = await gate.get('approval-1');
    expect(loaded).toBeDefined();
    expect(loaded!.requestedAt).toBeInstanceOf(Date);
    expect(loaded!.status).toBe('pending');
  });
});

describe('ApprovalGate.waitForDecision', () => {
  it('returns immediately when the request is already decided', async () => {
    const gate = await freshGate();
    const req = (await gate.request('agent_b', 'git.push', 'git-tool', {})).value!;
    await gate.deny(req.id, 'human', 'no');

    const result = await gate.waitForDecision(req.id, 1000);
    expect(result.status).toBe('denied');
  });

  it('throws when no decision arrives within the timeout', async () => {
    const gate = await freshGate();
    const req = (await gate.request('agent_b', 'git.push', 'git-tool', {})).value!;

    const pending = gate.waitForDecision(req.id, 3000);
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(3100);

    await expect(pending).rejects.toThrow('Approval timeout for ' + req.id);
  });

  it('resolves after an out-of-band decision while waiting', async () => {
    const gate = await freshGate();
    const req = (await gate.request('agent_b', 'git.push', 'git-tool', {})).value!;

    const pending = gate.waitForDecision(req.id, 10000);
    await gate.approve(req.id, 'human-owner');
    await vi.advanceTimersByTimeAsync(1000);

    const result = await pending;
    expect(result.status).toBe('approved');
  });
});
