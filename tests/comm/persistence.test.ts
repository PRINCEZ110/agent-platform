import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { persistence } from '../../src/comm/persistence.js';
import { createStatusUpdate } from '../../src/comm/messages.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

const msg = (id: string) => ({ ...createStatusUpdate('agent_b', { taskId: 'T1', status: 'completed' }), id });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('persistence.saveMessage', () => {
  it('creates agent dir, writes message file and appends to inbox', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('no inbox yet'));
    const result = await persistence.saveMessage('agent_b', msg('msg-fixed'));

    expect(result.ok).toBe(true);
    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(vi.mocked(writeFile).mock.calls[0][0]).toContain('msg-fixed.json');
    expect(vi.mocked(writeFile).mock.calls[1][0]).toContain('inbox.json');
    expect(JSON.parse(vi.mocked(writeFile).mock.calls[1][1] as string)).toEqual(['msg-fixed']);
  });

  it('appends to an existing inbox', async () => {
    vi.mocked(readFile).mockResolvedValue('["msg-1"]' as never);
    const result = await persistence.saveMessage('agent_b', msg('msg-2'));

    expect(result.ok).toBe(true);
    expect(JSON.parse(vi.mocked(writeFile).mock.calls[1][1] as string)).toEqual(['msg-1', 'msg-2']);
  });

  it('returns a CommunicationError result when the write fails', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full') as never);
    const result = await persistence.saveMessage('agent_b', msg('msg-x'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe('CommunicationError');
      expect(result.error.message).toContain('disk full');
    }
  });
});

describe('persistence.loadMessage', () => {
  it('returns the parsed message', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(msg('msg-1')) as never);
    const result = await persistence.loadMessage('agent_b', 'msg-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('msg-1');
      expect(result.value.type).toBe('status_update');
    }
  });

  it('returns a CommunicationError result when the file is missing', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const result = await persistence.loadMessage('agent_b', 'nope');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('CommunicationError');
  });
});

describe('persistence.loadMessages', () => {
  it('excludes inbox.json and reads remaining message files', async () => {
    vi.mocked(readdir).mockResolvedValue(['inbox.json', 'msg-2.json', 'msg-1.json'] as never);
    vi.mocked(readFile)
      .mockResolvedValueOnce(JSON.stringify(msg('msg-2')) as never)
      .mockResolvedValueOnce(JSON.stringify(msg('msg-1')) as never);

    const messages = await persistence.loadMessages('agent_b');

    expect(messages).toHaveLength(2);
    expect(messages.map(m => m.id)).toEqual(['msg-2', 'msg-1']);
    for (const call of vi.mocked(readFile).mock.calls) {
      expect(String(call[0])).not.toContain('inbox.json');
    }
  });

  it('returns an empty array when the agent dir does not exist', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
    expect(await persistence.loadMessages('ghost')).toEqual([]);
  });
});

describe('persistence inbox operations', () => {
  it('loadInbox returns ids', async () => {
    vi.mocked(readFile).mockResolvedValue('["a","b"]' as never);
    expect(await persistence.loadInbox('agent_b')).toEqual(['a', 'b']);
  });

  it('loadInbox returns [] when unreadable', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    expect(await persistence.loadInbox('agent_b')).toEqual([]);
  });

  it('markRead removes a single id and persists', async () => {
    vi.mocked(readFile).mockResolvedValue('["a","b","c"]' as never);
    const result = await persistence.markRead('agent_b', 'b');

    expect(result.ok).toBe(true);
    expect(JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string)).toEqual(['a', 'c']);
  });

  it('markRead returns error when write fails', async () => {
    vi.mocked(readFile).mockResolvedValue('["a"]' as never);
    vi.mocked(writeFile).mockRejectedValue(new Error('read-only') as never);
    const result = await persistence.markRead('agent_b', 'a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('CommunicationError');
  });

  it('clearInbox persists an empty inbox', async () => {
    const result = await persistence.clearInbox('agent_b');
    expect(result.ok).toBe(true);
    expect(vi.mocked(writeFile).mock.calls[0][1]).toBe('[]');
  });
});
