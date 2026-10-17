import type { InboxRepository } from './messaging/inbox.repository';
import type { OutboxRepository } from './messaging/outbox.repository';
import type { WagerTransactionRepository } from './wager-transaction/wager-transaction.repository';
import type { WalletRepository } from './wallet/wallet.repository';

export interface Repositories {
  readonly wallets: WalletRepository;
  readonly transactions: WagerTransactionRepository;
  readonly inbox: InboxRepository;
  readonly outbox: OutboxRepository;
}

export interface UnitOfWork {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
