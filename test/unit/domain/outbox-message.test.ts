import { describe, expect, it } from 'bun:test';
import type { IntegrationEvent } from '../../../src/domain/messaging/integration-event';
import { OutboxMessage } from '../../../src/domain/messaging/outbox-message';
import { WagerTransactionProcessed } from '../../../src/domain/messaging/events/wager-transaction-processed';
import { Money } from '../../../src/domain/money/money';
import { WagerTransactionKind } from '../../../src/domain/wager-transaction/enums';
import { WagerTransaction } from '../../../src/domain/wager-transaction/wager-transaction';

const AT = new Date('2026-01-01T00:00:00.000Z');

function sampleEvent(): IntegrationEvent<unknown> {
  const transaction = WagerTransaction.create({
    id: 'tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-a:external-1',
    payloadHash: 'hash',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    createdAt: AT,
  });
  return WagerTransactionProcessed.from(transaction, {
    eventId: 'event-1',
    correlationId: 'corr-1',
    occurredAt: AT,
  });
}

describe('OutboxMessage', () => {
  it('enqueues an event with the event id and its envelope as payload', () => {
    const event = sampleEvent();
    const message = OutboxMessage.enqueue(event, { createdAt: AT });

    expect(message.id).toBe('event-1');
    expect(message.aggregateId).toBe('wallet-1');
    expect(message.eventType).toBe('WagerTransactionProcessed');
    expect(message.payload).toEqual(event.toJSON() as unknown as Record<string, unknown>);
    expect(message.attempts).toBe(0);
    expect(message.isPending()).toBe(true);
    expect(message.isDue(AT)).toBe(true);
  });

  it('schedules retries with exponential backoff and increments attempts', () => {
    const message = OutboxMessage.enqueue(sampleEvent(), { createdAt: AT });

    message.scheduleRetry(AT);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt).toEqual(new Date(AT.getTime() + 1_000));
    expect(message.isDue(new Date(AT.getTime() + 999))).toBe(false);
    expect(message.isDue(new Date(AT.getTime() + 1_000))).toBe(true);

    message.scheduleRetry(AT);
    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt).toEqual(new Date(AT.getTime() + 2_000));
  });

  it('is no longer pending or due once published', () => {
    const message = OutboxMessage.enqueue(sampleEvent(), { createdAt: AT });
    message.markPublished(AT);
    expect(message.isPending()).toBe(false);
    expect(message.isDue(new Date(AT.getTime() + 60_000))).toBe(false);
  });

  it('rehydrates persisted state', () => {
    const message = OutboxMessage.rehydrate({
      id: 'event-1',
      aggregateId: 'wallet-1',
      eventType: 'X',
      payload: { a: 1 },
      occurredAt: AT,
      attempts: 3,
      nextAttemptAt: AT,
      publishedAt: undefined,
      createdAt: AT,
    });
    expect(message.attempts).toBe(3);
    expect(message.isPending()).toBe(true);
  });
});
