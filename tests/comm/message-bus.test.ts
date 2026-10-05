import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile } from 'fs/promises';
import { MessageBus, createMessageBus } from '../../src/comm/message-bus.js';
import { createStatusUpdate, createAcknowledgment, createHeartbeat, createTaskAssign, Message } from '../../src/comm/messages.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

const status = (id?: string): Message =>
  (id ? { ...createStatusUpdate('agent_b', { taskId: 'T1', status: 'in_progress', progress: 10 }), id } : createStatusUpdate('agent_b', { taskId: 'T1', status: 'in_progress', progress: 10 }));

let bus: MessageBus;

beforeEach(() => {
  vi.resetAllMocks();
  bus = new MessageBus('agent_b');
});

describe('MessageBus publish/subscribe', () => {
  it('delivers to a type subscriber and a wildcard subscriber', async () => {
    const typed = vi.fn();
    const all = vi.fn();
    bus.subscribe('status_update', typed);
    bus.subscribeAll(all);

    const res = await bus.publish(status());

    expect(res.ok).toBe(true);
    expect(typed).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(1);
  });

  it('does not deliver to subscribers of other types', async () => {
    const other = vi.fn();
    bus.subscribe('escalation', other);
    await bus.publish(status());
    expect(other).not.toHaveBeenCalled();
  });

  it('emits both the generic and the type-specific event', async () => {
    const onMessage = vi.fn();
    const onType = vi.fn();
    bus.on('message', onMessage);
    bus.on('status_update', onType);
    await bus.publish(status());
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onType).toHaveBeenCalledTimes(1);
  });

  it('honours the unsubscribe function returned by subscribe', async () => {
    const cb = vi.fn();
    const off = bus.subscribe('status_update', cb);
    off();
    await bus.publish(status());
    expect(cb).not.toHaveBeenCalled();
  });

  it('a throwing subscriber does not fail the publish', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    bus.subscribe('status_update', bad);
    bus.subscribe('status_update', good);

    const res = await bus.publish(status());
    expect(res.ok).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('send addresses the message to the recipient', async () => {
    const seen: Message[] = [];
    bus.subscribeAll(m => {
      seen.push(m);
    });
    await bus.send('agent_a', status());
    expect(seen).toHaveLength(1);
    expect(seen[0].to).toBe('agent_a');
  });

  it('records history and filters it by type and limit', async () => {
    await bus.publish(status('msg-1'));
    await bus.publish(createHeartbeat('agent_b', { agentId: 'agent_b', status: 'working' }));
    await bus.publish(status('msg-3'));

    const ids = bus.getHistory().map(m => m.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe('msg-1');
    expect(bus.getHistory('status_update').map(m => m.id)).toEqual(['msg-1', 'msg-3']);
    expect(bus.getHistory(undefined, 2)).toHaveLength(2);
    expect(bus.getAgentId()).toBe('agent_b');
  });

  it('still publishes when persistence fails silently (ENH-001: Result of saveMessage is ignored)', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full') as never);
    const cb = vi.fn();
    bus.subscribe('status_update', cb);

    const res = await bus.publish(status());

    expect(res.ok).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('MessageBus.requestResponse', () => {
  it('resolves with the correlated response of the expected type', async () => {
    const request = createStatusUpdate('agent_a', { taskId: 'T1', status: 'planned' });
    const pending = bus.requestResponse('agent_b', request, 'acknowledgment', 5000);

    const ack = {
      ...createAcknowledgment('agent_b', 'agent_a', { originalMessageId: request.id, accepted: true }),
      correlationId: request.id
    };
    await bus.publish(ack);

    const res = await pending;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.id).toBe(ack.id);
  });

  it('ignores responses with a non-matching correlationId', async () => {
    const request = createStatusUpdate('agent_a', { taskId: 'T1', status: 'planned' });
    let settled = false;
    const pending = bus.requestResponse('agent_b', request, 'acknowledgment', 5000);
    pending.then(() => {
      settled = true;
    });

    await bus.publish({
      ...createAcknowledgment('agent_b', 'agent_a', { originalMessageId: 'other', accepted: true }),
      correlationId: 'other-id'
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await bus.publish({
      ...createAcknowledgment('agent_b', 'agent_a', { originalMessageId: request.id, accepted: true }),
      correlationId: request.id
    });
    const res = await pending;
    expect(res.ok).toBe(true);
  });

  it('returns a CommunicationError result on timeout', async () => {
    const request = createStatusUpdate('agent_a', { taskId: 'T1', status: 'planned' });
    const pending = bus.requestResponse('agent_b', request, 'acknowledgment', 5000);

    await vi.advanceTimersByTimeAsync(5001);

    const res = await pending;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.name).toBe('CommunicationError');
      expect(res.error.message).toContain('timeout');
    }
  });
});

describe('MessageBus.acknowledge', () => {
  it('publishes an acknowledgment referencing the original message', async () => {
    const original = createTaskAssign('agent_a', 'agent_b', { taskId: 'T1', title: 't', description: 'd', priority: 'high' });
    const seen: Message[] = [];
    bus.subscribeAll(m => {
      seen.push(m);
    });

    await bus.acknowledge(original, false, 'needs rework');

    expect(seen).toHaveLength(1);
    const ack = seen[0];
    expect(ack.type).toBe('acknowledgment');
    expect(ack.to).toBe(original.from);
    if (ack.type === 'acknowledgment') {
      expect(ack.payload.originalMessageId).toBe(original.id);
      expect(ack.payload.accepted).toBe(false);
      expect(ack.payload.message).toBe('needs rework');
    }
  });
});
