import type { MoneyProps } from '../domain/money/money';
import type { WalletLedgerEntry } from '../domain/wallet/wallet-ledger-entry';
import type { Wallet } from '../domain/wallet/wallet';

export interface WalletResponse {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyProps;
  readonly version: number;
}

export interface LedgerEntryResponse {
  readonly id: string;
  readonly transactionId: string;
  readonly direction: string;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly createdAt: string;
}

export interface LedgerResponse {
  readonly entries: LedgerEntryResponse[];
  readonly nextCursor: string | null;
}

export function toWalletResponse(wallet: Wallet): WalletResponse {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}

export function toLedgerEntryResponse(entry: WalletLedgerEntry): LedgerEntryResponse {
  return {
    id: entry.id,
    transactionId: entry.transactionId,
    direction: entry.direction,
    money: entry.money.toJSON(),
    balanceBefore: entry.balanceBefore.toJSON(),
    balanceAfter: entry.balanceAfter.toJSON(),
    createdAt: entry.createdAt.toISOString(),
  };
}
