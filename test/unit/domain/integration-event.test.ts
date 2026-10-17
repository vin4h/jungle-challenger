import { describe, expect, it } from 'bun:test';
import { WalletBalanceChanged } from '../../../src/domain/messaging/events/wallet-balance-changed';
import { WagerTransactionProcessed } from '../../../src/domain/messaging/events/wager-transaction-processed';
import { Money } from '../../../src/domain/money/money';
import { LedgerDirection } from '../../../src/domain/wallet/ledger-direction';
import { Wallet } from '../../../src/domain/wallet/wallet';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../src/domain/wager-transaction/enums';
import { WagerTransaction } from '../../../src/domain/wager-transaction/wager-transaction';

const money = (amount: string): Money => Money.from({ amount, currency: 'BRL' });
const AT = new Date('2026-01-01T00:00:00.000Z');

function transaction(): WagerTransaction {
  return WagerTransaction.create({
    id: 'tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-a:external-1',
    payloadHash: 'hash',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: money('25.00'),
    createdAt: AT,
  });
}

describe('IntegrationEvent', () => {
  it('serializes a typed envelope with ISO-8601 and MoneyProps', () => {
    const event = WagerTransactionProcessed.from(transaction(), {
      eventId: 'event-1',
      correlationId: 'corr-1',
      occurredAt: AT,
    });

    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.version).toBe(1);
    expect(event.toJSON()).toEqual({
      eventId: 'event-1',
      eventType: 'WagerTransactionProcessed',
      aggregateId: 'wallet-1',
      correlationId: 'corr-1',
      causationId: undefined,
      occurredAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      data: {
        transactionId: 'tx-1',
        walletId: 'wallet-1',
        providerId: 'provider-a',
        externalTransactionId: 'external-1',
        kind: WagerTransactionKind.Bet,
        status: WagerTransactionStatus.Pending,
        money: { amount: '25.00', currency: 'BRL' },
      },
    });
  });

  it('carries Money as MoneyProps, never as a Money instance', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: money('0.00'),
      occurredAt: AT,
    });
    const entry = wallet.credit(money('100.00'), {
      ledgerEntryId: 'entry-1',
      transactionId: 'tx-1',
      occurredAt: AT,
    });

    const event = WalletBalanceChanged.from(wallet, entry, {
      eventId: 'event-2',
      correlationId: 'corr-1',
      occurredAt: AT,
    });

    expect(event.data.direction).toBe(LedgerDirection.Credit);
    expect(event.data.money).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(event.data.balanceBefore).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(event.data.balanceAfter).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(event.data.walletVersion).toBe(2);
  });
});
