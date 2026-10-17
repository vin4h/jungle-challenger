import { describe, expect, it } from 'bun:test';
import { MetricsRegistry } from '../../../src/observability/metrics.registry';
import { MetricsService } from '../../../src/observability/metrics.service';

function service(): MetricsService {
  return new MetricsService(new MetricsRegistry());
}

describe('MetricsService', () => {
  it('renders counters with labels in Prometheus format', () => {
    const metrics = service();
    metrics.wagerProcessed('PROCESSED', 'BET', 0.02);
    metrics.wagerProcessed('REJECTED', 'BET', 0.01);

    const text = metrics.render();
    expect(text).toContain('# TYPE wager_transactions_total counter');
    expect(text).toContain('wager_transactions_total{status="PROCESSED",kind="BET"} 1');
    expect(text).toContain('wager_transactions_total{status="REJECTED",kind="BET"} 1');
  });

  it('renders histogram buckets, sum and count', () => {
    const metrics = service();
    metrics.walletLockWait(0.02);

    const text = metrics.render();
    expect(text).toContain('# TYPE wallet_lock_wait_seconds histogram');
    expect(text).toContain('wallet_lock_wait_seconds_bucket{le="0.025"} 1');
    expect(text).toContain('wallet_lock_wait_seconds_bucket{le="+Inf"} 1');
    expect(text).toContain('wallet_lock_wait_seconds_count 1');
    expect(text).toContain('wallet_lock_wait_seconds_sum 0.02');
  });

  it('renders gauges and simple counters', () => {
    const metrics = service();
    metrics.outboxLag(12.5);
    metrics.idempotentReplay();
    metrics.consumerOutcome('duplicate');

    const text = metrics.render();
    expect(text).toContain('outbox_lag_seconds 12.5');
    expect(text).toContain('wager_idempotent_replays_total 1');
    expect(text).toContain('consumer_messages_total{outcome="duplicate"} 1');
  });
});
