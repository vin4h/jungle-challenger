import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';
import type { OutboxMessage } from '../../domain/messaging/outbox-message';
import type { ClaimDueOptions, OutboxRepository } from '../../domain/messaging/outbox.repository';
import { OutboxMessageEntity } from './entities/outbox-message.entity';
import { OutboxMessageMapper, type OutboxMessageRow } from './mappers/outbox-message.mapper';

export class TypeOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly manager: EntityManager) {}

  async enqueue(messages: readonly OutboxMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    await this.manager.insert(
      OutboxMessageEntity,
      messages.map(OutboxMessageMapper.toRow) as QueryDeepPartialEntity<OutboxMessageEntity>[],
    );
  }

  async findById(id: string): Promise<OutboxMessage | null> {
    const entity = await this.manager.findOne(OutboxMessageEntity, { where: { id } });
    return entity ? OutboxMessageMapper.toDomain(entity) : null;
  }

  async claimDue(options: ClaimDueOptions): Promise<OutboxMessage[]> {
    const result = await this.manager.query<OutboxMessageRow[] | [OutboxMessageRow[], number]>(
      `UPDATE "outbox_messages"
          SET "claimed_until" = $1
        WHERE "id" IN (
          SELECT "id" FROM "outbox_messages"
           WHERE "published_at" IS NULL
             AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= $2)
             AND ("claimed_until" IS NULL OR "claimed_until" <= $2)
           ORDER BY "occurred_at" ASC
           LIMIT $3
           FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "aggregate_id", "event_type", "payload", "occurred_at",
                  "attempts", "next_attempt_at", "claimed_until", "published_at", "created_at"`,
      [options.leaseUntil, options.now, options.limit],
    );
    const rows = Array.isArray(result[0]) ? (result as [OutboxMessageRow[], number])[0] : (result as OutboxMessageRow[]);
    return rows.map(OutboxMessageMapper.toDomainFromRow);
  }

  async markPublished(id: string, publishedAt: Date): Promise<void> {
    await this.manager.update(
      OutboxMessageEntity,
      { id },
      { publishedAt, claimedUntil: null },
    );
  }

  async scheduleRetry(id: string, nextAttemptAt: Date, attempts: number): Promise<void> {
    await this.manager.update(
      OutboxMessageEntity,
      { id },
      { nextAttemptAt, attempts, claimedUntil: null },
    );
  }
}
