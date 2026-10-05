import { describe, it, expect } from 'vitest';
import {
  MessageSchema,
  MessageTypeSchema,
  createTaskAssign,
  createStatusUpdate,
  createReviewRequest,
  createContextHandoff,
  createEscalation,
  createAcknowledgment,
  createHeartbeat
} from '../../src/comm/messages.js';

describe('MessageTypeSchema', () => {
  it('accepts all seven protocol message types', () => {
    for (const t of ['task_assign', 'status_update', 'review_request', 'context_handoff', 'escalation', 'acknowledgment', 'heartbeat']) {
      expect(MessageTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('rejects unknown message types', () => {
    expect(MessageTypeSchema.safeParse('task_assigned').success).toBe(false);
  });
});

describe('MessageSchema', () => {
  it('applies default id and timestamp when omitted', () => {
    const parsed = MessageSchema.parse({
      type: 'heartbeat',
      from: 'agent_b',
      payload: { agentId: 'agent_b', status: 'idle' }
    });
    expect(parsed.id).toMatch(/^msg-/);
    expect(parsed.timestamp).toBeInstanceOf(Date);
  });

  it('rejects unknown top-level type (discriminated union)', () => {
    const result = MessageSchema.safeParse({
      type: 'execute_shell',
      from: 'agent_b',
      payload: {}
    });
    expect(result.success).toBe(false);
  });

  it('rejects task_assign missing required payload field', () => {
    const result = MessageSchema.safeParse({
      type: 'task_assign',
      from: 'agent_a',
      to: 'agent_b',
      payload: { taskId: 'TASK-020', priority: 'high' }
    });
    expect(result.success).toBe(false);
  });

  it('rejects task_assign with invalid priority', () => {
    const result = MessageSchema.safeParse({
      type: 'task_assign',
      from: 'agent_a',
      payload: { taskId: 'TASK-020', title: 't', description: 'd', priority: 'urgent' }
    });
    expect(result.success).toBe(false);
  });

  it('rejects status_update with progress outside 0..100', () => {
    const base = { taskId: 'TASK-020', status: 'in_progress' };
    expect(MessageSchema.safeParse({ type: 'status_update', from: 'agent_b', payload: { ...base, progress: 150 } }).success).toBe(false);
    expect(MessageSchema.safeParse({ type: 'status_update', from: 'agent_b', payload: { ...base, progress: -1 } }).success).toBe(false);
    expect(MessageSchema.safeParse({ type: 'status_update', from: 'agent_b', payload: { ...base, progress: 100 } }).success).toBe(true);
  });

  it('rejects status_update with status outside the protocol state set', () => {
    const result = MessageSchema.safeParse({
      type: 'status_update',
      from: 'agent_b',
      payload: { taskId: 'TASK-020', status: 'DONE' }
    });
    expect(result.success).toBe(false);
  });

  it('rejects escalation with invalid severity', () => {
    const result = MessageSchema.safeParse({
      type: 'escalation',
      from: 'agent_b',
      payload: { taskId: 'TASK-020', reason: 'blocked', severity: 'fatal' }
    });
    expect(result.success).toBe(false);
  });

  it('round-trips correlationId when present', () => {
    const msg = MessageSchema.parse({
      id: 'msg-1',
      type: 'acknowledgment',
      from: 'agent_a',
      to: 'agent_b',
      timestamp: new Date('2026-10-05T00:00:00.000Z'),
      correlationId: 'task-orig',
      payload: { originalMessageId: 'task-orig', accepted: true }
    });
    expect(msg.correlationId).toBe('task-orig');
    expect(msg.timestamp.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('message factory helpers', () => {
  const cases: Array<[string, (from: string, to: string) => ReturnType<typeof createTaskAssign>, string]> = [
    ['task_assign', (f, t) => createTaskAssign(f, t, { taskId: 'T1', title: 'title', description: 'desc', priority: 'high' }), 'task_assign'],
    ['status_update', (f) => createStatusUpdate(f, { taskId: 'T1', status: 'completed', progress: 100 }), 'status_update'],
    ['review_request', (f, t) => createReviewRequest(f, t, { taskId: 'T1', reviewType: 'code', files: ['src/index.ts'], urgency: 'high' }), 'review_request'],
    ['context_handoff', (f, t) => createContextHandoff(f, t, { taskId: 'T1', context: { key: 'value' }, reason: 'handover' }), 'context_handoff'],
    ['escalation', (f, t) => createEscalation(f, t, { taskId: 'T1', reason: 'blocked by dependency', severity: 'error' }), 'escalation'],
    ['acknowledgment', (f, t) => createAcknowledgment(f, t, { originalMessageId: 'msg-1', accepted: false }), 'acknowledgment'],
    ['heartbeat', (f) => createHeartbeat(f, { agentId: 'agent_b', status: 'working', load: 42 }), 'heartbeat']
  ];

  for (const [name, factory, expectedType] of cases) {
    it(`creates a schema-valid ${name} message`, () => {
      const msg = factory('agent_a', 'agent_b');
      expect(msg.type).toBe(expectedType);
      expect(msg.from).toBe('agent_a');
      const result = MessageSchema.safeParse(msg);
      expect(result.success, `factory ${name} produced schema-invalid message`).toBe(true);
    });
  }

  it('generates unique ids across messages', () => {
    const a = createStatusUpdate('agent_b', { taskId: 'T1', status: 'completed' });
    const b = createStatusUpdate('agent_b', { taskId: 'T1', status: 'completed' });
    expect(a.id).not.toBe(b.id);
  });
});
