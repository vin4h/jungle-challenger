import type { OutboxMessage } from './outbox-message';

export interface OutboxRepository {
  enqueue(messages: readonly OutboxMessage[]): Promise<void>;
  findById(id: string): Promise<OutboxMessage | null>;
  listDue(now: Date, limit: number): Promise<OutboxMessage[]>;
  markPublished(id: string, publishedAt: Date): Promise<void>;
  scheduleRetry(id: string, nextAttemptAt: Date, attempts: number): Promise<void>;
}
