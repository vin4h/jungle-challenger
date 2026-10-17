import { describe, expect, it } from 'bun:test';
import { InvalidLedgerEntryError } from '../../../src/domain/errors/invalid-ledger-entry.error';
import { Money } from '../../../src/domain/money/money';
import { LedgerDirection } from '../../../src/domain/wallet/ledger-direction';
import { WalletLedgerEntry } from '../../../src/domain/wallet/wallet-ledger-entry';

const money = (amount: string): Money => Money.from({ amount, currency: 'BRL' });
const negative = (amount: string): Money => Money.zero('BRL').subtract(Money.from({ amount, currency: 'BRL' }));

const base = {
  id: 'entry-1',
  walletId: 'wallet-1',
  transactionId: 'tx-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('WalletLedgerEntry', () => {
  it('accepts a balanced CREDIT', () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.Credit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('125.00'),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it('accepts a balanced DEBIT', () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.Debit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('75.00'),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it('rejects an unbalanced entry', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Credit,
        money: money('25.00'),
        balanceBefore: money('100.00'),
        balanceAfter: money('124.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejects a non-positive movement amount', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Credit,
        money: Money.zero('BRL'),
        balanceBefore: money('100.00'),
        balanceAfter: money('100.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejects a negative resulting balance', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Debit,
        money: money('10.00'),
        balanceBefore: money('5.00'),
        balanceAfter: negative('5.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rehydrates persisted state without re-validating', () => {
    const entry = WalletLedgerEntry.rehydrate({
      ...base,
      direction: LedgerDirection.Debit,
      money: money('10.00'),
      balanceBefore: money('5.00'),
      balanceAfter: negative('5.00'),
    });
    expect(entry.balanceAfter.toString()).toBe('-5.00');
  });

  it('is structurally immutable (no transition methods)', () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.Credit,
      money: money('1.00'),
      balanceBefore: Money.zero('BRL'),
      balanceAfter: money('1.00'),
    }) as unknown as Record<string, unknown>;
    for (const method of ['update', 'delete', 'setAmount', 'markProcessed']) {
      expect(entry[method]).toBeUndefined();
    }
  });
});
