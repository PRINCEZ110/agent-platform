import { Message, MessageType } from './messages.js';

export interface SubscriptionFilter {
  types?: MessageType[];
  from?: string[];
  to?: string[];
  correlationId?: string;
}

export class SubscriptionManager {
  private subscriptions = new Map<string, { filter: SubscriptionFilter; callback: (message: Message) => void }>();

  subscribe(id: string, filter: SubscriptionFilter, callback: (message: Message) => void): void {
    this.subscriptions.set(id, { filter, callback });
  }

  unsubscribe(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  notify(message: Message): void {
    for (const [, sub] of this.subscriptions) {
      if (this.matches(message, sub.filter)) {
        try {
          sub.callback(message);
        } catch (e) {
          console.error(`Subscription ${sub.filter} callback error:`, e);
        }
      }
    }
  }

  private matches(message: Message, filter: SubscriptionFilter): boolean {
    if (filter.types && !filter.types.includes(message.type)) return false;
    if (filter.from && !filter.from.includes(message.from)) return false;
    if (filter.to && message.to && !filter.to.includes(message.to)) return false;
    if (filter.correlationId && message.correlationId !== filter.correlationId) return false;
    return true;
  }

  getSubscriptionIds(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  clear(): void {
    this.subscriptions.clear();
  }
}

export const subscriptionManager = new SubscriptionManager();