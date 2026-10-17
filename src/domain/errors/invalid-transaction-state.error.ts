import { DomainError } from './domain-error';

export class InvalidTransactionStateError extends DomainError {
  readonly code = 'INVALID_TRANSACTION_STATE';

  constructor(current: string, attempted: string) {
    super(`Cannot ${attempted}: transaction is in a terminal state (${current})`);
  }
}
