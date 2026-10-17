import type { MoneyProps } from '../../money/money';
import type { WagerTransactionKind } from '../../wager-transaction/enums';
import type { WagerTransaction } from '../../wager-transaction/wager-transaction';
import type { EventContext } from '../event-context';
import { IntegrationEvent, type IntegrationEventProps } from '../integration-event';

export interface WagerTransactionPendingReferenceData {
  readonly transactionId: string;
  readonly walletId: string;
  readonly providerId: string | null;
  readonly externalTransactionId: string | null;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId: string | null;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WagerTransactionPendingReferenceData>) {
    super(props);
  }

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
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
        referenceExternalTransactionId: transaction.referenceExternalTransactionId ?? null,
      },
    });
  }
}
