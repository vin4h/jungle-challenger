import { Injectable } from '@nestjs/common';
import { MetricsRegistry } from './metrics.registry';

export type ConsumerOutcome = 'processed' | 'duplicate' | 'business_error' | 'dlq';

@Injectable()
export class MetricsService {
  constructor(private readonly registry: MetricsRegistry) {
    registry.registerCounter('wager_transactions_total', 'Wager transactions by status', [
      'status',
      'kind',
    ]);
    registry.registerCounter('wager_idempotent_replays_total', 'Idempotent replays served');
    registry.registerCounter('wager_duplicates_total', 'Duplicate deliveries detected');
    registry.registerCounter('outbox_published_total', 'Outbox events published');
    registry.registerCounter('outbox_retries_total', 'Outbox publish retries');
    registry.registerCounter('consumer_messages_total', 'Queue messages by outcome', ['outcome']);
    registry.registerHistogram('wager_processing_seconds', 'Wager processing latency');
    registry.registerHistogram('wallet_lock_wait_seconds', 'Wallet lock acquisition wait');
    registry.registerGauge('outbox_lag_seconds', 'Age of the oldest pending outbox message');
  }

  wagerProcessed(status: string, kind: string, seconds: number): void {
    this.registry.inc('wager_transactions_total', { status, kind });
    this.registry.observe('wager_processing_seconds', seconds);
  }

  idempotentReplay(): void {
    this.registry.inc('wager_idempotent_replays_total');
  }

  duplicate(): void {
    this.registry.inc('wager_duplicates_total');
  }

  outboxPublished(): void {
    this.registry.inc('outbox_published_total');
  }

  outboxRetry(): void {
    this.registry.inc('outbox_retries_total');
  }

  outboxLag(seconds: number): void {
    this.registry.setGauge('outbox_lag_seconds', seconds);
  }

  consumerOutcome(outcome: ConsumerOutcome): void {
    this.registry.inc('consumer_messages_total', { outcome });
  }

  walletLockWait(seconds: number): void {
    this.registry.observe('wallet_lock_wait_seconds', seconds);
  }

  render(): string {
    return this.registry.render();
  }
}
