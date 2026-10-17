import type { Wallet } from './wallet';
import type { WalletLedgerEntry } from './wallet-ledger-entry';

export interface LedgerCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface FindWalletOptions {
  readonly forUpdate?: boolean;
}

export interface ListLedgerEntriesOptions {
  readonly limit: number;
  readonly cursor?: LedgerCursor;
}

export interface LedgerEntriesPage {
  readonly entries: WalletLedgerEntry[];
  readonly nextCursor?: LedgerCursor;
}

export interface LedgerSum {
  readonly balanceAmount: string;
  readonly entries: number;
}

export interface WalletRepository {
  findById(id: string, options?: FindWalletOptions): Promise<Wallet | null>;
  findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  insert(wallet: Wallet): Promise<void>;
  update(wallet: Wallet): Promise<void>;
  insertLedgerEntries(entries: readonly WalletLedgerEntry[]): Promise<void>;
  listLedgerEntries(walletId: string, options: ListLedgerEntriesOptions): Promise<LedgerEntriesPage>;
  sumLedger(walletId: string): Promise<LedgerSum>;
}
