import { Inject, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DuplicateWagerTransactionError } from '../domain/errors/duplicate-wager-transaction.error';
import { IdempotencyConflictError } from '../domain/errors/idempotency-conflict.error';
import { InsufficientFundsError } from '../domain/errors/insufficient-funds.error';
import { WalletNotFoundError } from '../domain/errors/wallet-not-found.error';
import type { EventContext } from '../domain/messaging/event-context';
import { WagerTransactionPendingReference } from '../domain/messaging/events/wager-transaction-pending-reference';
import { WagerTransactionProcessed } from '../domain/messaging/events/wager-transaction-processed';
import { WagerTransactionRejected } from '../domain/messaging/events/wager-transaction-rejected';
import { WalletBalanceChanged } from '../domain/messaging/events/wallet-balance-changed';
import type { IntegrationEvent } from '../domain/messaging/integration-event';
import { OutboxMessage } from '../domain/messaging/outbox-message';
import { Money } from '../domain/money/money';
import { payloadHash } from '../domain/shared/hash';
import type { Repositories, UnitOfWork } from '../domain/unit-of-work';
import { LedgerDirection } from '../domain/wallet/ledger-direction';
import type { Wallet } from '../domain/wallet/wallet';
import type { WalletLedgerEntry } from '../domain/wallet/wallet-ledger-entry';
import { WagerTransactionKind, WagerTransactionStatus } from '../domain/wager-transaction/enums';
import { FailureCode } from '../domain/wager-transaction/failure-code';
import { WagerTransaction } from '../domain/wager-transaction/wager-transaction';
import { UNIT_OF_WORK } from '../infrastructure/persistence/persistence.tokens';

export interface ProcessWagerTransactionInput {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: { readonly amount: string; readonly currency: string };
  readonly referenceExternalTransactionId?: string;
  readonly correlationId?: string;
}

export interface WageringOutcome {
  readonly transaction: WagerTransaction;
  readonly idempotentReplay: boolean;
}

interface DispatchContext {
  readonly input: ProcessWagerTransactionInput;
  readonly transaction: WagerTransaction;
  readonly wallet: Wallet;
  readonly money: Money;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly events: IntegrationEvent<unknown>[];
  readonly ledgerEntries: WalletLedgerEntry[];
  readonly reject: (code: FailureCode) => void;
  readonly applyMovement: (
    direction: LedgerDirection,
    referenceTransactionId: string | undefined,
  ) => void;
}

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  async execute(input: ProcessWagerTransactionInput): Promise<WageringOutcome> {
    const money = Money.from(input.money);
    const occurredAt = new Date();
    const hash = this.computePayloadHash(input, money);

    try {
      return await this.unitOfWork.run(async (repositories) => {
        const existing = await repositories.transactions.findByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          return this.replayOrConflict(existing, hash, input.idempotencyKey);
        }

        const wallet = await repositories.wallets.findById(input.walletId, { forUpdate: true });
        if (!wallet) {
          throw new WalletNotFoundError(input.walletId);
        }

        const transaction = WagerTransaction.create({
          id: uuidv7(),
          providerId: input.providerId,
          externalTransactionId: input.externalTransactionId,
          idempotencyKey: input.idempotencyKey,
          payloadHash: hash,
          walletId: input.walletId,
          playerId: input.playerId,
          roundId: input.roundId,
          gameId: input.gameId,
          kind: input.kind,
          money,
          referenceExternalTransactionId: input.referenceExternalTransactionId,
          createdAt: occurredAt,
        });

        const correlationId = input.correlationId ?? transaction.id;
        const events: IntegrationEvent<unknown>[] = [];
        const ledgerEntries: WalletLedgerEntry[] = [];

        const reject = (code: FailureCode): void => {
          transaction.reject(code);
          transaction.setResultBalance(wallet.balance);
          events.push(WagerTransactionRejected.from(transaction, this.eventContext(correlationId, occurredAt)));
        };

        const applyMovement = (
          direction: LedgerDirection,
          referenceTransactionId: string | undefined,
        ): void => {
          const entry =
            direction === LedgerDirection.Debit
              ? wallet.debit(money, this.movementContext(transaction.id, occurredAt))
              : wallet.credit(money, this.movementContext(transaction.id, occurredAt));
          ledgerEntries.push(entry);
          transaction.markProcessed(referenceTransactionId, occurredAt);
          transaction.setResultBalance(wallet.balance);
          events.push(WalletBalanceChanged.from(wallet, entry, this.eventContext(correlationId, occurredAt)));
          events.push(WagerTransactionProcessed.from(transaction, this.eventContext(correlationId, occurredAt)));
        };

        await this.dispatch(repositories, {
          input,
          transaction,
          wallet,
          money,
          occurredAt,
          correlationId,
          events,
          ledgerEntries,
          reject,
          applyMovement,
        });

        await repositories.transactions.insert(transaction);
        if (ledgerEntries.length > 0) {
          await repositories.wallets.insertLedgerEntries(ledgerEntries);
          await repositories.wallets.update(wallet);
        }
        if (events.length > 0) {
          await repositories.outbox.enqueue(
            events.map((event) => OutboxMessage.enqueue(event, { createdAt: occurredAt })),
          );
        }

        return { transaction, idempotentReplay: false };
      });
    } catch (error) {
      if (error instanceof DuplicateWagerTransactionError) {
        const existing = await this.unitOfWork.run((repositories) =>
          repositories.transactions.findByIdempotencyKey(input.idempotencyKey),
        );
        if (existing) {
          return this.replayOrConflict(existing, hash, input.idempotencyKey);
        }
      }
      throw error;
    }
  }

  private async dispatch(repositories: Repositories, context: DispatchContext): Promise<void> {
    const { input, transaction, wallet, money, occurredAt, events, reject, applyMovement } = context;

    if (money.currency !== wallet.currency) {
      reject(FailureCode.CurrencyMismatch);
      return;
    }

    if (transaction.kind === WagerTransactionKind.Loss) {
      transaction.markProcessed(undefined, occurredAt);
      transaction.setResultBalance(wallet.balance);
      events.push(WagerTransactionProcessed.from(transaction, this.eventContext(context.correlationId, occurredAt)));
      return;
    }

    if (transaction.requiresReference()) {
      const reference = await repositories.transactions.findByProviderAndExternalId(
        input.providerId,
        transaction.referenceExternalTransactionId as string,
      );

      if (!reference) {
        transaction.markPendingReference();
        transaction.setResultBalance(wallet.balance);
        events.push(
          WagerTransactionPendingReference.from(transaction, this.eventContext(context.correlationId, occurredAt)),
        );
        return;
      }

      const failure = await this.validateReversal(repositories, transaction, reference);
      if (failure) {
        reject(failure);
        return;
      }

      try {
        applyMovement(transaction.ledgerDirectionFor(reference), reference.id);
      } catch (error) {
        if (error instanceof InsufficientFundsError) {
          reject(FailureCode.ReversalWouldGoNegative);
          return;
        }
        throw error;
      }
      return;
    }

    let failure: FailureCode | undefined;
    if (transaction.referenceExternalTransactionId) {
      const reference = await repositories.transactions.findByProviderAndExternalId(
        input.providerId,
        transaction.referenceExternalTransactionId,
      );
      failure = reference
        ? this.validateReferenceIdentity(transaction, reference)
        : FailureCode.ReferenceNotFound;
    }

    if (failure) {
      reject(failure);
      return;
    }

    try {
      applyMovement(
        transaction.kind === WagerTransactionKind.Bet ? LedgerDirection.Debit : LedgerDirection.Credit,
        undefined,
      );
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        reject(FailureCode.InsufficientFunds);
        return;
      }
      throw error;
    }
  }

  private validateReferenceIdentity(
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): FailureCode | undefined {
    const sameIdentity =
      reference.providerId === transaction.providerId &&
      reference.playerId === transaction.playerId &&
      reference.walletId === transaction.walletId &&
      reference.roundId === transaction.roundId &&
      reference.money.currency === transaction.money.currency;
    return sameIdentity ? undefined : FailureCode.ReferenceMismatch;
  }

  private async validateReversal(
    repositories: Repositories,
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): Promise<FailureCode | undefined> {
    const identity = this.validateReferenceIdentity(transaction, reference);
    if (identity) {
      return identity;
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      return FailureCode.ReferenceNotReversible;
    }

    const allowed =
      transaction.kind === WagerTransactionKind.Refund
        ? reference.kind === WagerTransactionKind.Bet
        : reference.kind === WagerTransactionKind.Bet ||
          reference.kind === WagerTransactionKind.Win ||
          reference.kind === WagerTransactionKind.Refund;
    if (!allowed) {
      return FailureCode.ReferenceNotReversible;
    }

    if (!reference.money.equals(transaction.money)) {
      return FailureCode.AmountMismatch;
    }

    const alreadyReversed = await repositories.transactions.findReversalOf(reference.id, transaction.kind);
    if (alreadyReversed) {
      return FailureCode.AlreadyReversed;
    }

    return undefined;
  }

  private replayOrConflict(
    existing: WagerTransaction,
    payloadHashValue: string,
    idempotencyKey: string,
  ): WageringOutcome {
    if (!existing.matchesPayload(payloadHashValue)) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    return { transaction: existing, idempotentReplay: true };
  }

  private eventContext(correlationId: string, occurredAt: Date): EventContext {
    return { eventId: uuidv7(), correlationId, occurredAt };
  }

  private movementContext(transactionId: string, occurredAt: Date) {
    return { ledgerEntryId: uuidv7(), transactionId, occurredAt };
  }

  private computePayloadHash(input: ProcessWagerTransactionInput, money: Money): string {
    return payloadHash({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: { amount: money.toString(), currency: money.currency },
      referenceExternalTransactionId: input.referenceExternalTransactionId ?? null,
    });
  }
}
