import { Money } from '../../../domain/money/money';
import { LedgerDirection } from '../../../domain/wallet/ledger-direction';
import { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';

export const LedgerEntryMapper = {
  toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction as LedgerDirection,
      money: Money.rehydrate({ amount: entity.amount, currency: entity.currency }),
      balanceBefore: Money.rehydrate({ amount: entity.balanceBefore, currency: entity.currency }),
      balanceAfter: Money.rehydrate({ amount: entity.balanceAfter, currency: entity.currency }),
      createdAt: entity.createdAt,
    });
  },

  toRow(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
    return Object.assign(new WalletLedgerEntryEntity(), {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: entry.money.toString(),
      currency: entry.money.currency,
      balanceBefore: entry.balanceBefore.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      createdAt: entry.createdAt,
    });
  },
};
