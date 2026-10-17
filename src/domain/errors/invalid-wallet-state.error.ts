import { DomainError } from './domain-error';

export class InvalidWalletStateError extends DomainError {
  readonly code = 'INVALID_WALLET_STATE';

  constructor(reason: string) {
    super(`Invalid wallet state: ${reason}`);
  }
}
