import { EventEmitter } from 'events';
import { Message, MessageType, createAcknowledgment } from './messages.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { CommunicationError } from '@core/errors.js';
import { persistence } from './persistence.js';

type MessageHandler = (message: Message) => Promise<void> | void;

export class MessageBus extends EventEmitter {
  private subscriptions = new Map<MessageType, Set<MessageHandler>>();
  private wildcardSubscriptions = new Set<MessageHandler>();
  private messageHistory: Message[] = [];
  private maxHistory = 1000;
  private agentId: string;

  constructor(agentId: string) {
    super();
    this.agentId = agentId;
    this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    try {
      const history = await persistence.loadMessages(this.agentId);
      this.messageHistory = history.slice(-this.maxHistory);
    } catch {
      // Ignore load errors
    }
  }

  subscribe(type: MessageType, handler: MessageHandler): () => void {
    if (!this.subscriptions.has(type)) {
      this.subscriptions.set(type, new Set());
    }
    this.subscriptions.get(type)!.add(handler);
    return () => this.unsubscribe(type, handler);
  }

  subscribeAll(handler: MessageHandler): () => void {
    this.wildcardSubscriptions.add(handler);
    return () => this.wildcardSubscriptions.delete(handler);
  }

  unsubscribe(type: MessageType, handler: MessageHandler): void {
    this.subscriptions.get(type)?.delete(handler);
  }

  async publish(message: Message): Promise<ResultOrError<void>> {
    try {
      await persistence.saveMessage(this.agentId, message);
      this.messageHistory.push(message);
      if (this.messageHistory.length > this.maxHistory) {
        this.messageHistory.shift();
      }

      const handlers = this.subscriptions.get(message.type) ?? new Set();
      const allHandlers = [...handlers, ...this.wildcardSubscriptions];

      await Promise.all(allHandlers.map(async h => {
        try {
          await h(message);
        } catch (e) {
          console.error(e);
        }
      }));

      this.emit('message', message);
      this.emit(message.type, message);

      return ok(undefined);
    } catch (e) {
      return err(new CommunicationError(`Failed to publish message: ${e instanceof Error ? e.message : 'Unknown error'}`, 'publish', e instanceof Error ? e : undefined));
    }
  }

  async send(to: string, message: Message): Promise<ResultOrError<void>> {
    const addressed = { ...message, to };
    return this.publish(addressed);
  }

  async requestResponse<M extends Message>(
    to: string,
    message: Message,
    expectedType: M['type'],
    timeoutMs = 30000
  ): Promise<ResultOrError<M>> {
    return new Promise((resolve) => {
      const correlationId = message.id;
      const handler = (response: Message) => {
        if (response.correlationId === correlationId && response.type === expectedType) {
          this.unsubscribe(expectedType, handler);
          resolve(ok(response as M));
        }
      };

      this.subscribe(expectedType, handler);

      setTimeout(() => {
        this.unsubscribe(expectedType, handler);
        resolve(err(new CommunicationError(`Request timeout for ${expectedType}`, 'requestResponse')));
      }, timeoutMs);

      this.send(to, { ...message, correlationId }).catch(e => {
        this.unsubscribe(expectedType, handler);
        resolve(err(e));
      });
    });
  }

  async acknowledge(originalMessage: Message, accepted: boolean, message?: string): Promise<ResultOrError<void>> {
    const ack = createAcknowledgment(this.agentId, originalMessage.from, {
      originalMessageId: originalMessage.id,
      accepted,
      message
    });
    return this.publish(ack);
  }

  getHistory(type?: MessageType, limit = 100): Message[] {
    let filtered = this.messageHistory;
    if (type) {
      filtered = filtered.filter(m => m.type === type);
    }
    return filtered.slice(-limit);
  }

  getAgentId(): string {
    return this.agentId;
  }
}

export function createMessageBus(agentId: string): MessageBus {
  return new MessageBus(agentId);
}