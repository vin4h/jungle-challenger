import { DomainError } from './domain-error';

export class WagerTransactionNotFoundError extends DomainError {
  readonly code = 'WAGER_TRANSACTION_NOT_FOUND';

  constructor(identifier: string) {
    super(`Wager transaction not found: ${identifier}`);
  }
}
