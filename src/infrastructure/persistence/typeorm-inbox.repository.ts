import type { EntityManager } from 'typeorm';
import type { InboxMessage } from '../../domain/messaging/inbox-message';
import type { InboxRepository } from '../../domain/messaging/inbox.repository';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { InboxMessageMapper } from './mappers/inbox-message.mapper';

export class TypeOrmInboxRepository implements InboxRepository {
  constructor(private readonly manager: EntityManager) {}

  async tryInsert(message: InboxMessage): Promise<boolean> {
    const rows = await this.manager.query<Array<{ message_id: string }>>(
      `INSERT INTO "inbox_messages" ("message_id", "consumer_name", "payload_hash", "received_at", "processed_at")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("consumer_name", "message_id") DO NOTHING
       RETURNING "message_id"`,
      [
        message.messageId,
        message.consumerName,
        message.payloadHash,
        message.receivedAt,
        message.processedAt ?? null,
      ],
    );
    return rows.length > 0;
  }

  async markProcessed(consumerName: string, messageId: string, processedAt: Date): Promise<void> {
    await this.manager.update(InboxMessageEntity, { consumerName, messageId }, { processedAt });
  }

  async findByMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const entity = await this.manager.findOne(InboxMessageEntity, {
      where: { consumerName, messageId },
    });
    return entity ? InboxMessageMapper.toDomain(entity) : null;
  }
}
