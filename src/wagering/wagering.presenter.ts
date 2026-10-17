import type { MoneyProps } from '../domain/money/money';
import type { WagerTransactionStatus } from '../domain/wager-transaction/enums';
import type { FailureCode } from '../domain/wager-transaction/failure-code';
import type { WagerTransaction } from '../domain/wager-transaction/wager-transaction';

export interface WageringResponse {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance: MoneyProps | null;
  readonly idempotentReplay: boolean;
  readonly failureCode?: FailureCode;
}

export function toWageringResponse(
  transaction: WagerTransaction,
  idempotentReplay: boolean,
): WageringResponse {
  return {
    transactionId: transaction.id,
    status: transaction.status,
    balance: transaction.resultBalance?.toJSON() ?? null,
    idempotentReplay,
    ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
  };
}
