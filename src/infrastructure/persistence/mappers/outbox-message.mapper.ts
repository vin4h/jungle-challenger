import { OutboxMessage } from '../../../domain/messaging/outbox-message';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';

export interface OutboxMessageRow {
  readonly id: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly payload: Record<string, unknown>;
  readonly occurred_at: Date;
  readonly attempts: number;
  readonly next_attempt_at: Date | null;
  readonly claimed_until: Date | null;
  readonly published_at: Date | null;
  readonly created_at: Date;
}

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
      claimedUntil: entity.claimedUntil ?? undefined,
      publishedAt: entity.publishedAt ?? undefined,
      createdAt: entity.createdAt,
    });
  },

  toDomainFromRow(row: OutboxMessageRow): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: row.id,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: row.payload,
      occurredAt: row.occurred_at,
      attempts: Number(row.attempts),
      nextAttemptAt: row.next_attempt_at ?? undefined,
      claimedUntil: row.claimed_until ?? undefined,
      publishedAt: row.published_at ?? undefined,
      createdAt: row.created_at,
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
      claimedUntil: message.claimedUntil ?? null,
      publishedAt: message.publishedAt ?? null,
      createdAt: message.createdAt,
    });
  },
};
