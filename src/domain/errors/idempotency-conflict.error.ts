import { DomainError } from './domain-error';

export class IdempotencyConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was reused with a different payload`);
  }
}
