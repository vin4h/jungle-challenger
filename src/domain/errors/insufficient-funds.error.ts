import { DomainError } from './domain-error';

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(balance: string, amount: string, currency: string) {
    super(
      `Insufficient funds: balance ${balance} ${currency} is lower than requested ${amount} ${currency}`,
    );
  }
}
