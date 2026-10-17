import { DomainError } from './domain-error';

export class WalletAlreadyExistsError extends DomainError {
  readonly code = 'WALLET_ALREADY_EXISTS';

  constructor(playerId: string, currency: string) {
    super(`A wallet already exists for player ${playerId} in ${currency}`);
  }
}
