import type { MoneyProps } from '../../money/money';
import type { WagerTransactionKind } from '../../wager-transaction/enums';
import type { FailureCode } from '../../wager-transaction/failure-code';
import type { WagerTransaction } from '../../wager-transaction/wager-transaction';
import type { EventContext } from '../event-context';
import { IntegrationEvent, type IntegrationEventProps } from '../integration-event';

export interface WagerTransactionRejectedData {
  readonly transactionId: string;
  readonly walletId: string;
  readonly providerId: string | null;
  readonly externalTransactionId: string | null;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly failureCode: FailureCode | null;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WagerTransactionRejectedData>) {
    super(props);
  }

  static from(transaction: WagerTransaction, context: EventContext): WagerTransactionRejected {
    return new WagerTransactionRejected({
      eventId: context.eventId,
      aggregateId: transaction.walletId,
      correlationId: context.correlationId,
      causationId: context.causationId,
      occurredAt: context.occurredAt,
      data: {
        transactionId: transaction.id,
        walletId: transaction.walletId,
        providerId: transaction.providerId ?? null,
        externalTransactionId: transaction.externalTransactionId ?? null,
        kind: transaction.kind,
        money: transaction.money.toJSON(),
        failureCode: transaction.failureCode ?? null,
      },
    });
  }
}
