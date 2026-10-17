import { Inject, Injectable } from '@nestjs/common';
import { WagerTransactionNotFoundError } from '../domain/errors/wager-transaction-not-found.error';
import type { UnitOfWork } from '../domain/unit-of-work';
import type { WagerTransaction } from '../domain/wager-transaction/wager-transaction';
import { UNIT_OF_WORK } from '../infrastructure/persistence/persistence.tokens';

@Injectable()
export class WageringService {
  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  async getById(id: string): Promise<WagerTransaction> {
    return this.unitOfWork.run(async ({ transactions }) => {
      const transaction = await transactions.findById(id);
      if (!transaction) {
        throw new WagerTransactionNotFoundError(id);
      }
      return transaction;
    });
  }

  async getByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction> {
    return this.unitOfWork.run(async ({ transactions }) => {
      const transaction = await transactions.findByProviderAndExternalId(
        providerId,
        externalTransactionId,
      );
      if (!transaction) {
        throw new WagerTransactionNotFoundError(`${providerId}:${externalTransactionId}`);
      }
      return transaction;
    });
  }
}
