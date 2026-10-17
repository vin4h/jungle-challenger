import { DomainError } from './domain-error';

export class DuplicateWagerTransactionError extends DomainError {
  readonly code = 'DUPLICATE_WAGER_TRANSACTION';

  constructor(idempotencyKey: string) {
    super(`A wager transaction already exists for idempotency key "${idempotencyKey}"`);
  }
}
