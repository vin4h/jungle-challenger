import type { MoneyProps } from '../../money/money';
import type { LedgerDirection } from '../../wallet/ledger-direction';
import type { Wallet } from '../../wallet/wallet';
import type { WalletLedgerEntry } from '../../wallet/wallet-ledger-entry';
import type { EventContext } from '../event-context';
import { IntegrationEvent, type IntegrationEventProps } from '../integration-event';

export interface WalletBalanceChangedData {
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
    super(props);
  }

  static from(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    context: EventContext,
  ): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: context.eventId,
      aggregateId: wallet.id,
      correlationId: context.correlationId,
      causationId: context.causationId,
      occurredAt: context.occurredAt,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
}
