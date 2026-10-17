import { DomainError } from './domain-error';

export class WalletNotFoundError extends DomainError {
  readonly code = 'WALLET_NOT_FOUND';

  constructor(walletId: string) {
    super(`Wallet not found: ${walletId}`);
  }
}
