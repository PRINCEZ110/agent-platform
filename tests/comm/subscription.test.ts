import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubscriptionManager, SubscriptionFilter } from '../../src/comm/subscription.js';
import { createStatusUpdate, createTaskAssign, Message } from '../../src/comm/messages.js';

const statusMsg = (extra: Partial<Message> = {}): Message => ({
  ...createStatusUpdate('agent_b', { taskId: 'T1', status: 'completed', progress: 100 }),
  ...extra
});

const taskMsg = (): Message =>
  createTaskAssign('agent_a', 'agent_b', { taskId: 'T1', title: 't', description: 'd', priority: 'high' });

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager();
  });

  it('delivers messages matching a type filter', () => {
    const cb = vi.fn();
    manager.subscribe('sub-1', { types: ['status_update'] }, cb);
    manager.notify(statusMsg());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not deliver messages of other types', () => {
    const cb = vi.fn();
    manager.subscribe('sub-1', { types: ['status_update'] }, cb);
    manager.notify(taskMsg());
    expect(cb).not.toHaveBeenCalled();
  });

  it('delivers when multiple filter dimensions match', () => {
    const cb = vi.fn();
    const filter: SubscriptionFilter = { types: ['status_update'], from: ['agent_b'], to: ['agent_a'] };
    manager.subscribe('sub-1', filter, cb);
    manager.notify(statusMsg({ to: 'agent_a' }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('filters by from', () => {
    const hit = vi.fn();
    const miss = vi.fn();
    manager.subscribe('hit', { from: ['agent_b'] }, hit);
    manager.subscribe('miss', { from: ['agent_a'] }, miss);
    manager.notify(statusMsg());
    expect(hit).toHaveBeenCalledTimes(1);
    expect(miss).not.toHaveBeenCalled();
  });

  it('filters by to when the message is addressed', () => {
    const hit = vi.fn();
    const miss = vi.fn();
    manager.subscribe('hit', { to: ['agent_a'] }, hit);
    manager.subscribe('miss', { to: ['agent_c'] }, miss);
    manager.notify(statusMsg({ to: 'agent_a' }));
    expect(hit).toHaveBeenCalledTimes(1);
    expect(miss).not.toHaveBeenCalled();
  });

  it('delivers to a to-filter even when message has no recipient (documented quirk)', () => {
    const cb = vi.fn();
    manager.subscribe('sub-1', { to: ['agent_a'] }, cb);
    manager.notify(statusMsg());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('filters by correlationId', () => {
    const hit = vi.fn();
    const miss = vi.fn();
    manager.subscribe('hit', { correlationId: 'corr-1' }, hit);
    manager.subscribe('miss', { correlationId: 'corr-2' }, miss);
    manager.notify(statusMsg({ correlationId: 'corr-1' }));
    expect(hit).toHaveBeenCalledTimes(1);
    expect(miss).not.toHaveBeenCalled();
  });

  it('an empty filter matches everything', () => {
    const cb = vi.fn();
    manager.subscribe('sub-1', {}, cb);
    manager.notify(statusMsg());
    manager.notify(taskMsg());
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes by id and reports result', () => {
    const cb = vi.fn();
    manager.subscribe('sub-1', {}, cb);
    expect(manager.unsubscribe('sub-1')).toBe(true);
    expect(manager.unsubscribe('sub-1')).toBe(false);
    manager.notify(statusMsg());
    expect(cb).not.toHaveBeenCalled();
  });

  it('one throwing callback does not prevent delivery to others', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    manager.subscribe('bad', {}, bad);
    manager.subscribe('good', {}, good);
    manager.notify(statusMsg());
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('exposes subscription ids and clears them', () => {
    manager.subscribe('a', {}, vi.fn());
    manager.subscribe('b', {}, vi.fn());
    expect(manager.getSubscriptionIds().sort()).toEqual(['a', 'b']);
    manager.clear();
    expect(manager.getSubscriptionIds()).toEqual([]);
  });
});
