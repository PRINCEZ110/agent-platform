import { z } from 'zod';
import { generateId } from '@core/utils.js';

export const MessageTypeSchema = z.enum([
  'task_assign',
  'status_update',
  'review_request',
  'context_handoff',
  'escalation',
  'acknowledgment',
  'heartbeat'
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const BaseMessageSchema = z.object({
  id: z.string().default(() => generateId('msg')),
  type: MessageTypeSchema,
  from: z.string(),
  to: z.string().optional(),
  timestamp: z.date().default(() => new Date()),
  correlationId: z.string().optional()
});

export const TaskAssignPayloadSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  dependencies: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  context: z.record(z.unknown()).optional()
});
export type TaskAssignPayload = z.infer<typeof TaskAssignPayloadSchema>;

export const StatusUpdatePayloadSchema = z.object({
  taskId: z.string(),
  status: z.enum(['planned', 'ready', 'in_progress', 'blocked', 'review', 'completed', 'abandoned']),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  output: z.record(z.unknown()).optional()
});
export type StatusUpdatePayload = z.infer<typeof StatusUpdatePayloadSchema>;

export const ReviewRequestPayloadSchema = z.object({
  taskId: z.string(),
  reviewType: z.enum(['code', 'architecture', 'security', 'performance']),
  files: z.array(z.string()),
  questions: z.array(z.string()).optional(),
  urgency: z.enum(['low', 'medium', 'high'])
});
export type ReviewRequestPayload = z.infer<typeof ReviewRequestPayloadSchema>;

export const ContextHandoffPayloadSchema = z.object({
  taskId: z.string(),
  context: z.record(z.unknown()),
  reason: z.string(),
  relevantFiles: z.array(z.string()).optional(),
  decisions: z.array(z.string()).optional()
});
export type ContextHandoffPayload = z.infer<typeof ContextHandoffPayloadSchema>;

export const EscalationPayloadSchema = z.object({
  taskId: z.string(),
  reason: z.string(),
  severity: z.enum(['warning', 'error', 'critical']),
  blockedOn: z.array(z.string()).optional(),
  suggestedResolution: z.string().optional()
});
export type EscalationPayload = z.infer<typeof EscalationPayloadSchema>;

export const AcknowledgmentPayloadSchema = z.object({
  originalMessageId: z.string(),
  accepted: z.boolean(),
  message: z.string().optional()
});
export type AcknowledgmentPayload = z.infer<typeof AcknowledgmentPayloadSchema>;

export const HeartbeatPayloadSchema = z.object({
  agentId: z.string(),
  status: z.enum(['idle', 'working', 'blocked', 'offline']),
  currentTask: z.string().optional(),
  load: z.number().min(0).max(100).optional()
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

export const TaskAssignMessageSchema = BaseMessageSchema.extend({ type: z.literal('task_assign'), payload: TaskAssignPayloadSchema });
export const StatusUpdateMessageSchema = BaseMessageSchema.extend({ type: z.literal('status_update'), payload: StatusUpdatePayloadSchema });
export const ReviewRequestMessageSchema = BaseMessageSchema.extend({ type: z.literal('review_request'), payload: ReviewRequestPayloadSchema });
export const ContextHandoffMessageSchema = BaseMessageSchema.extend({ type: z.literal('context_handoff'), payload: ContextHandoffPayloadSchema });
export const EscalationMessageSchema = BaseMessageSchema.extend({ type: z.literal('escalation'), payload: EscalationPayloadSchema });
export const AcknowledgmentMessageSchema = BaseMessageSchema.extend({ type: z.literal('acknowledgment'), payload: AcknowledgmentPayloadSchema });
export const HeartbeatMessageSchema = BaseMessageSchema.extend({ type: z.literal('heartbeat'), payload: HeartbeatPayloadSchema });

export const MessageSchema = z.discriminatedUnion('type', [
  TaskAssignMessageSchema,
  StatusUpdateMessageSchema,
  ReviewRequestMessageSchema,
  ContextHandoffMessageSchema,
  EscalationMessageSchema,
  AcknowledgmentMessageSchema,
  HeartbeatMessageSchema
]);

export type Message = z.infer<typeof MessageSchema>;

export function createTaskAssign(from: string, to: string, payload: TaskAssignPayload): Message {
  return {
    id: generateId('task'),
    type: 'task_assign',
    from,
    to,
    timestamp: new Date(),
    payload
  };
}

export function createStatusUpdate(from: string, payload: StatusUpdatePayload): Message {
  return {
    id: generateId('status'),
    type: 'status_update',
    from,
    timestamp: new Date(),
    payload
  };
}

export function createReviewRequest(from: string, to: string, payload: ReviewRequestPayload): Message {
  return {
    id: generateId('review'),
    type: 'review_request',
    from,
    to,
    timestamp: new Date(),
    payload
  };
}

export function createContextHandoff(from: string, to: string, payload: ContextHandoffPayload): Message {
  return {
    id: generateId('handoff'),
    type: 'context_handoff',
    from,
    to,
    timestamp: new Date(),
    payload
  };
}

export function createEscalation(from: string, to: string, payload: EscalationPayload): Message {
  return {
    id: generateId('escalation'),
    type: 'escalation',
    from,
    to,
    timestamp: new Date(),
    payload
  };
}

export function createAcknowledgment(from: string, to: string, payload: AcknowledgmentPayload): Message {
  return {
    id: generateId('ack'),
    type: 'acknowledgment',
    from,
    to,
    timestamp: new Date(),
    payload
  };
}

export function createHeartbeat(from: string, payload: HeartbeatPayload): Message {
  return {
    id: generateId('heartbeat'),
    type: 'heartbeat',
    from,
    timestamp: new Date(),
    payload
  };
}

export interface SubscriptionFilter {
  types?: MessageType[];
  from?: string[];
  to?: string[];
  correlationId?: string;
}