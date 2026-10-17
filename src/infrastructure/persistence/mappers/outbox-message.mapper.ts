import { OutboxMessage } from '../../../domain/messaging/outbox-message';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';

export const OutboxMessageMapper = {
  toDomain(entity: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt ?? undefined,
      publishedAt: entity.publishedAt ?? undefined,
      createdAt: entity.createdAt,
    });
  },

  toRow(message: OutboxMessage): OutboxMessageEntity {
    return Object.assign(new OutboxMessageEntity(), {
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload,
      occurredAt: message.occurredAt,
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt ?? null,
      publishedAt: message.publishedAt ?? null,
      createdAt: message.createdAt,
    });
  },
};
