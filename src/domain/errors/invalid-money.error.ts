import { DomainError } from './domain-error';

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';

  constructor(reason: string) {
    super(`Invalid money: ${reason}`);
  }
}
