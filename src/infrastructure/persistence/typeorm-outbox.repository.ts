import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';
import type { OutboxMessage } from '../../domain/messaging/outbox-message';
import type { OutboxRepository } from '../../domain/messaging/outbox.repository';
import { OutboxMessageEntity } from './entities/outbox-message.entity';
import { OutboxMessageMapper } from './mappers/outbox-message.mapper';

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

  async listDue(now: Date, limit: number): Promise<OutboxMessage[]> {
    const entities = await this.manager
      .createQueryBuilder(OutboxMessageEntity, 'outbox')
      .where('outbox.publishedAt IS NULL')
      .andWhere('(outbox.nextAttemptAt IS NULL OR outbox.nextAttemptAt <= :now)', { now })
      .orderBy('outbox.occurredAt', 'ASC')
      .take(limit)
      .getMany();
    return entities.map(OutboxMessageMapper.toDomain);
  }

  async markPublished(id: string, publishedAt: Date): Promise<void> {
    await this.manager.update(OutboxMessageEntity, { id }, { publishedAt });
  }

  async scheduleRetry(id: string, nextAttemptAt: Date, attempts: number): Promise<void> {
    await this.manager.update(OutboxMessageEntity, { id }, { nextAttemptAt, attempts });
  }
}
