import type { InboxMessage } from './inbox-message';

export interface InboxRepository {
  tryInsert(message: InboxMessage): Promise<boolean>;
  markProcessed(consumerName: string, messageId: string, processedAt: Date): Promise<void>;
  findByMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null>;
}
