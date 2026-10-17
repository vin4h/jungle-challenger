import { DomainError } from './domain-error';

export class InvalidWagerTransactionError extends DomainError {
  readonly code = 'INVALID_WAGER_TRANSACTION';

  constructor(reason: string) {
    super(`Invalid wager transaction: ${reason}`);
  }
}
