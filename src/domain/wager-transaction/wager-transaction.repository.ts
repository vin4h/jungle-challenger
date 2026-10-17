import type { WagerTransaction } from './wager-transaction';

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  insert(transaction: WagerTransaction): Promise<void>;
  update(transaction: WagerTransaction): Promise<void>;
}
