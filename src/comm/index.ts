// Inter-agent communication - barrel export
export { MessageBus, createMessageBus } from './message-bus.js';
export { 
  createTaskAssign, 
  createStatusUpdate, 
  createReviewRequest, 
  createContextHandoff, 
  createEscalation, 
  createAcknowledgment, 
  createHeartbeat 
} from './messages.js';
export { persistence } from './persistence.js';
export { SubscriptionManager, subscriptionManager } from './subscription.js';
export type { 
  MessageType, 
  TaskAssignPayload, 
  StatusUpdatePayload, 
  ReviewRequestPayload, 
  ContextHandoffPayload, 
  EscalationPayload, 
  AcknowledgmentPayload, 
  HeartbeatPayload,
  SubscriptionFilter 
} from './messages.js';