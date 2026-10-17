import type { EntityManager } from 'typeorm';
import type { WagerTransaction } from '../../domain/wager-transaction/wager-transaction';
import type { WagerTransactionRepository } from '../../domain/wager-transaction/wager-transaction.repository';
import { WagerTransactionEntity } from './entities/wager-transaction.entity';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper';

export class TypeOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly manager: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.manager.findOne(WagerTransactionEntity, { where: { id } });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.manager.findOne(WagerTransactionEntity, {
      where: { providerId, externalTransactionId },
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async insert(transaction: WagerTransaction): Promise<void> {
    await this.manager.insert(WagerTransactionEntity, WagerTransactionMapper.toRow(transaction));
  }

  async update(transaction: WagerTransaction): Promise<void> {
    await this.manager.update(
      WagerTransactionEntity,
      { id: transaction.id },
      {
        status: transaction.status,
        referenceTransactionId: transaction.referenceTransactionId ?? null,
        failureCode: transaction.failureCode ?? null,
        processedAt: transaction.processedAt ?? null,
      },
    );
  }
}
