import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError } from '../../../src/domain/errors/currency-mismatch.error';
import { InsufficientFundsError } from '../../../src/domain/errors/insufficient-funds.error';
import { InvalidWalletStateError } from '../../../src/domain/errors/invalid-wallet-state.error';
import { Money } from '../../../src/domain/money/money';
import { LedgerDirection } from '../../../src/domain/wallet/ledger-direction';
import { Wallet } from '../../../src/domain/wallet/wallet';

const money = (amount: string): Money => Money.from({ amount, currency: 'BRL' });
const AT = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-01T00:05:00.000Z');

function openWallet(amount = '100.00'): Wallet {
  return Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: money(amount),
    occurredAt: AT,
    opening: { transactionId: 'opening-tx', ledgerEntryId: 'opening-entry' },
  });
}

const ctx = (suffix: string, at = LATER) => ({
  ledgerEntryId: `entry-${suffix}`,
  transactionId: `tx-${suffix}`,
  occurredAt: at,
});

describe('Wallet', () => {
  describe('open', () => {
    it('creates a wallet with the opening balance at version 1', () => {
      const wallet = openWallet('100.00');
      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.currency).toBe('BRL');
      expect(wallet.version).toBe(1);
      expect(wallet.createdAt).toBe(AT);
      expect(wallet.updatedAt).toBe(AT);
    });

    it('records exactly one balanced CREDIT ledger entry for the opening', () => {
      const wallet = openWallet('100.00');
      const entries = wallet.pullLedgerEntries();
      expect(entries).toHaveLength(1);
      const entry = entries[0]!;
      expect(entry.direction).toBe(LedgerDirection.Credit);
      expect(entry.balanceBefore.toString()).toBe('0.00');
      expect(entry.balanceAfter.toString()).toBe('100.00');
      expect(entry.isBalanced()).toBe(true);
    });

    it('creates no ledger entry when the initial balance is zero', () => {
      const wallet = openWallet('0.00');
      expect(wallet.balance.toString()).toBe('0.00');
      expect(wallet.version).toBe(1);
      expect(wallet.pullLedgerEntries()).toHaveLength(0);
    });

    it('requires an opening transaction for a positive balance', () => {
      expect(() =>
        Wallet.open({
          id: 'wallet-1',
          playerId: 'player-1',
          initialBalance: money('10.00'),
          occurredAt: AT,
        }),
      ).toThrow(InvalidWalletStateError);
    });

    it('rejects a negative initial balance', () => {
      const negative = money('0.00').subtract(money('1.00'));
      expect(() =>
        Wallet.open({ id: 'w', playerId: 'p', initialBalance: negative, occurredAt: AT }),
      ).toThrow(InvalidWalletStateError);
    });
  });

  describe('movements', () => {
    it('debits, updates the balance and increments the version', () => {
      const wallet = openWallet('100.00');
      wallet.pullLedgerEntries();
      const entry = wallet.debit(money('25.00'), ctx('bet'));

      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.balanceBefore.toString()).toBe('100.00');
      expect(entry.balanceAfter.toString()).toBe('75.00');
      expect(wallet.balance.toString()).toBe('75.00');
      expect(wallet.version).toBe(2);
      expect(wallet.updatedAt).toBe(LATER);
    });

    it('credits and increments the version', () => {
      const wallet = openWallet('100.00');
      wallet.pullLedgerEntries();
      const entry = wallet.credit(money('50.00'), ctx('win'));

      expect(entry.direction).toBe(LedgerDirection.Credit);
      expect(wallet.balance.toString()).toBe('150.00');
      expect(wallet.version).toBe(2);
    });

    it('rejects a debit that would produce a negative balance without changing state', () => {
      const wallet = openWallet('100.00');
      wallet.pullLedgerEntries();
      expect(() => wallet.debit(money('120.00'), ctx('bet'))).toThrow(InsufficientFundsError);
      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(wallet.pullLedgerEntries()).toHaveLength(0);
    });

    it('rejects movements in a different currency', () => {
      const wallet = openWallet('100.00');
      const usd = Money.from({ amount: '1.00', currency: 'USD' });
      expect(() => wallet.debit(usd, ctx('bet'))).toThrow(CurrencyMismatchError);
      expect(() => wallet.credit(usd, ctx('win'))).toThrow(CurrencyMismatchError);
    });

    it('rejects non-positive movement amounts', () => {
      const wallet = openWallet('100.00');
      expect(() => wallet.credit(Money.zero('BRL'), ctx('win'))).toThrow(InvalidWalletStateError);
      expect(() => wallet.debit(money('0.00'), ctx('bet'))).toThrow(InvalidWalletStateError);
    });

    it('keeps balance and ledger consistent across several movements', () => {
      const wallet = openWallet('100.00');
      wallet.pullLedgerEntries();
      wallet.debit(money('30.00'), ctx('bet'));
      wallet.credit(money('5.00'), ctx('win'));
      wallet.debit(money('10.00'), ctx('bet-2'));

      const entries = wallet.pullLedgerEntries();
      expect(wallet.balance.toString()).toBe('65.00');
      expect(wallet.version).toBe(4);
      expect(entries).toHaveLength(3);
      for (const entry of entries) {
        expect(entry.isBalanced()).toBe(true);
      }
      expect(entries[2]!.balanceAfter.toString()).toBe('65.00');
    });
  });

  describe('rehydrate', () => {
    it('reconstructs persisted state without pending ledger entries', () => {
      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: money('42.00'),
        version: 7,
        createdAt: AT,
        updatedAt: LATER,
      });

      expect(wallet.balance.toString()).toBe('42.00');
      expect(wallet.version).toBe(7);
      expect(wallet.updatedAt).toBe(LATER);
      expect(wallet.pullLedgerEntries()).toHaveLength(0);
    });
  });
});
