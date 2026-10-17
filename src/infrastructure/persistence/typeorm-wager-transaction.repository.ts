import type { EntityManager } from 'typeorm';
import { DuplicateWagerTransactionError } from '../../domain/errors/duplicate-wager-transaction.error';
import { WagerTransactionStatus, type WagerTransactionKind } from '../../domain/wager-transaction/enums';
import type { WagerTransaction } from '../../domain/wager-transaction/wager-transaction';
import type { WagerTransactionRepository } from '../../domain/wager-transaction/wager-transaction.repository';
import { WagerTransactionEntity } from './entities/wager-transaction.entity';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper';
import { isUniqueViolation } from './typeorm-errors';

export class TypeOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly manager: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.manager.findOne(WagerTransactionEntity, { where: { id } });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const entity = await this.manager.findOne(WagerTransactionEntity, {
      where: { idempotencyKey },
    });
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

  async findReversalOf(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null> {
    const entity = await this.manager.findOne(WagerTransactionEntity, {
      where: {
        referenceTransactionId,
        kind,
        status: WagerTransactionStatus.Processed,
      },
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async insert(transaction: WagerTransaction): Promise<void> {
    try {
      await this.manager.insert(WagerTransactionEntity, WagerTransactionMapper.toRow(transaction));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateWagerTransactionError(transaction.idempotencyKey);
      }
      throw error;
    }
  }

  async update(transaction: WagerTransaction): Promise<void> {
    await this.manager.update(
      WagerTransactionEntity,
      { id: transaction.id },
      {
        status: transaction.status,
        referenceTransactionId: transaction.referenceTransactionId ?? null,
        failureCode: transaction.failureCode ?? null,
        resultBalanceAmount: transaction.resultBalance?.toString() ?? null,
        resultBalanceCurrency: transaction.resultBalance?.currency ?? null,
        processedAt: transaction.processedAt ?? null,
      },
    );
  }
}
