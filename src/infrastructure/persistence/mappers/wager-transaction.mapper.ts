import { Money } from '../../../domain/money/money';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../domain/wager-transaction/enums';
import type { FailureCode } from '../../../domain/wager-transaction/failure-code';
import { WagerTransaction } from '../../../domain/wager-transaction/wager-transaction';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';

export const WagerTransactionMapper = {
  toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId ?? undefined,
      externalTransactionId: entity.externalTransactionId ?? undefined,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId ?? undefined,
      gameId: entity.gameId ?? undefined,
      kind: entity.kind as WagerTransactionKind,
      money: Money.rehydrate({ amount: entity.amount, currency: entity.currency }),
      referenceExternalTransactionId: entity.referenceExternalTransactionId ?? undefined,
      status: entity.status as WagerTransactionStatus,
      referenceTransactionId: entity.referenceTransactionId ?? undefined,
      failureCode: (entity.failureCode as FailureCode | null) ?? undefined,
      processedAt: entity.processedAt ?? undefined,
      createdAt: entity.createdAt,
    });
  },

  toRow(transaction: WagerTransaction): WagerTransactionEntity {
    return Object.assign(new WagerTransactionEntity(), {
      id: transaction.id,
      kind: transaction.kind,
      status: transaction.status,
      providerId: transaction.providerId ?? null,
      externalTransactionId: transaction.externalTransactionId ?? null,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId ?? null,
      gameId: transaction.gameId ?? null,
      amount: transaction.money.toString(),
      currency: transaction.money.currency,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId ?? null,
      referenceTransactionId: transaction.referenceTransactionId ?? null,
      failureCode: transaction.failureCode ?? null,
      processedAt: transaction.processedAt ?? null,
      createdAt: transaction.createdAt,
    });
  },
};
