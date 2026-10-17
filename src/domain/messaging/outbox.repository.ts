import type { OutboxMessage } from './outbox-message';

export interface ClaimDueOptions {
  readonly now: Date;
  readonly leaseUntil: Date;
  readonly limit: number;
}

export interface OutboxRepository {
  enqueue(messages: readonly OutboxMessage[]): Promise<void>;
  findById(id: string): Promise<OutboxMessage | null>;
  claimDue(options: ClaimDueOptions): Promise<OutboxMessage[]>;
  markPublished(id: string, publishedAt: Date): Promise<void>;
  scheduleRetry(id: string, nextAttemptAt: Date, attempts: number): Promise<void>;
  oldestPendingOccurredAt(): Promise<Date | null>;
}
