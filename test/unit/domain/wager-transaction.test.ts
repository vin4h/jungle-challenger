import { describe, expect, it } from 'bun:test';
import { InvalidTransactionStateError } from '../../../src/domain/errors/invalid-transaction-state.error';
import { InvalidWagerTransactionError } from '../../../src/domain/errors/invalid-wager-transaction.error';
import { Money } from '../../../src/domain/money/money';
import { LedgerDirection } from '../../../src/domain/wallet/ledger-direction';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../src/domain/wager-transaction/enums';
import { FailureCode } from '../../../src/domain/wager-transaction/failure-code';
import { WagerTransaction } from '../../../src/domain/wager-transaction/wager-transaction';

const money = (amount: string): Money => Money.from({ amount, currency: 'BRL' });
const AT = new Date('2026-01-01T00:00:00.000Z');

function createTransaction(
  kind: WagerTransactionKind,
  extra: Partial<Parameters<typeof WagerTransaction.create>[0]> = {},
): WagerTransaction {
  return WagerTransaction.create({
    id: `tx-${kind}`,
    providerId: 'provider-a',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-a:external-1',
    payloadHash: 'payload-hash',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: money('25.00'),
    createdAt: AT,
    ...extra,
  });
}

describe('WagerTransaction', () => {
  describe('create', () => {
    it('rejects the internal OPENING kind', () => {
      expect(() => createTransaction(WagerTransactionKind.Opening)).toThrow(
        InvalidWagerTransactionError,
      );
    });

    it('requires a reference for REFUND and ROLLBACK', () => {
      expect(() => createTransaction(WagerTransactionKind.Refund)).toThrow(InvalidWagerTransactionError);
      expect(() => createTransaction(WagerTransactionKind.Rollback)).toThrow(
        InvalidWagerTransactionError,
      );
    });

    it('accepts a REFUND carrying a reference', () => {
      const refund = createTransaction(WagerTransactionKind.Refund, {
        referenceExternalTransactionId: 'external-1',
      });
      expect(refund.referenceExternalTransactionId).toBe('external-1');
      expect(refund.status).toBe(WagerTransactionStatus.Pending);
    });

    it('is born PENDING and not terminal', () => {
      const bet = createTransaction(WagerTransactionKind.Bet);
      expect(bet.status).toBe(WagerTransactionStatus.Pending);
      expect(bet.isTerminal()).toBe(false);
    });

    it('rejects a non-positive amount', () => {
      expect(() => createTransaction(WagerTransactionKind.Bet, { money: Money.zero('BRL') })).toThrow(
        InvalidWagerTransactionError,
      );
    });
  });

  describe('queries', () => {
    it('matches the canonical payload hash', () => {
      const bet = createTransaction(WagerTransactionKind.Bet);
      expect(bet.matchesPayload('payload-hash')).toBe(true);
      expect(bet.matchesPayload('other')).toBe(false);
    });

    it('flags balance effects and reference requirements', () => {
      expect(createTransaction(WagerTransactionKind.Bet).affectsBalance()).toBe(true);
      expect(createTransaction(WagerTransactionKind.Win).affectsBalance()).toBe(true);
      expect(createTransaction(WagerTransactionKind.Loss).affectsBalance()).toBe(false);
      expect(createTransaction(WagerTransactionKind.Rollback, { referenceExternalTransactionId: 'x' }).requiresReference()).toBe(true);
    });

    it('resolves the ledger direction', () => {
      expect(createTransaction(WagerTransactionKind.Bet).ledgerDirectionFor()).toBe(LedgerDirection.Debit);
      expect(createTransaction(WagerTransactionKind.Win).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect(
        createTransaction(WagerTransactionKind.Refund, { referenceExternalTransactionId: 'x' }).ledgerDirectionFor(),
      ).toBe(LedgerDirection.Credit);
    });

    it('inverts the direction of the reference for ROLLBACK', () => {
      const bet = createTransaction(WagerTransactionKind.Bet);
      const win = createTransaction(WagerTransactionKind.Win);
      const rollbackOfBet = createTransaction(WagerTransactionKind.Rollback, {
        referenceExternalTransactionId: 'x',
      });
      const rollbackOfWin = createTransaction(WagerTransactionKind.Rollback, {
        referenceExternalTransactionId: 'x',
      });
      expect(rollbackOfBet.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
      expect(rollbackOfWin.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
    });

    it('throws when a direction is requested for LOSS', () => {
      expect(() => createTransaction(WagerTransactionKind.Loss).ledgerDirectionFor()).toThrow(
        InvalidTransactionStateError,
      );
    });
  });

  describe('transitions', () => {
    it('processes and becomes terminal', () => {
      const bet = createTransaction(WagerTransactionKind.Bet);
      bet.markProcessed('reference-tx', AT);
      expect(bet.status).toBe(WagerTransactionStatus.Processed);
      expect(bet.referenceTransactionId).toBe('reference-tx');
      expect(bet.processedAt).toBe(AT);
      expect(bet.isTerminal()).toBe(true);
    });

    it('marks pending reference without becoming terminal', () => {
      const refund = createTransaction(WagerTransactionKind.Refund, {
        referenceExternalTransactionId: 'x',
      });
      refund.markPendingReference();
      expect(refund.status).toBe(WagerTransactionStatus.PendingReference);
      expect(refund.isTerminal()).toBe(false);
    });

    it('rejects with a failure code', () => {
      const bet = createTransaction(WagerTransactionKind.Bet);
      bet.reject(FailureCode.InsufficientFunds);
      expect(bet.status).toBe(WagerTransactionStatus.Rejected);
      expect(bet.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(bet.isTerminal()).toBe(true);
    });

    it('fails with a failure code', () => {
      const bet = createTransaction(WagerTransactionKind.Bet);
      bet.fail(FailureCode.InternalError);
      expect(bet.status).toBe(WagerTransactionStatus.Failed);
      expect(bet.failureCode).toBe(FailureCode.InternalError);
    });

    it('forbids transitions from a terminal state', () => {
      const bet = createTransaction(WagerTransactionKind.Bet);
      bet.markProcessed(undefined, AT);
      expect(() => bet.markProcessed(undefined, AT)).toThrow(InvalidTransactionStateError);
      expect(() => bet.reject(FailureCode.InsufficientFunds)).toThrow(InvalidTransactionStateError);
      expect(() => bet.fail(FailureCode.InternalError)).toThrow(InvalidTransactionStateError);
      expect(() => bet.markPendingReference()).toThrow(InvalidTransactionStateError);
    });
  });

  describe('open', () => {
    it('creates an internal OPENING transaction already PROCESSED', () => {
      const opening = WagerTransaction.open({
        id: 'opening-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        idempotencyKey: 'opening:wallet-1',
        payloadHash: 'hash',
        money: money('100.00'),
        occurredAt: AT,
      });

      expect(opening.kind).toBe(WagerTransactionKind.Opening);
      expect(opening.status).toBe(WagerTransactionStatus.Processed);
      expect(opening.providerId).toBeUndefined();
      expect(opening.externalTransactionId).toBeUndefined();
      expect(opening.processedAt).toBe(AT);
      expect(opening.isTerminal()).toBe(true);
    });
  });
});
