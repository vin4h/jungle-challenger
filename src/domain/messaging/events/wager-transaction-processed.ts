import type { MoneyProps } from '../../money/money';
import type { WagerTransactionKind, WagerTransactionStatus } from '../../wager-transaction/enums';
import type { WagerTransaction } from '../../wager-transaction/wager-transaction';
import type { EventContext } from '../event-context';
import { IntegrationEvent, type IntegrationEventProps } from '../integration-event';

export interface WagerTransactionProcessedData {
  readonly transactionId: string;
  readonly walletId: string;
  readonly providerId: string | null;
  readonly externalTransactionId: string | null;
  readonly kind: WagerTransactionKind;
  readonly status: WagerTransactionStatus;
  readonly money: MoneyProps;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WagerTransactionProcessedData>) {
    super(props);
  }

  static from(transaction: WagerTransaction, context: EventContext): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
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
        status: transaction.status,
        money: transaction.money.toJSON(),
      },
    });
  }
}
