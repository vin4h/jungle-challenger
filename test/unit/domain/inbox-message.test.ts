import { describe, expect, it } from 'bun:test';
import { InboxMessage } from '../../../src/domain/messaging/inbox-message';

const AT = new Date('2026-01-01T00:00:00.000Z');

describe('InboxMessage', () => {
  it('is received unprocessed', () => {
    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-transactions',
      payloadHash: 'hash',
      receivedAt: AT,
    });

    expect(message.messageId).toBe('msg-1');
    expect(message.consumerName).toBe('wager-transactions');
    expect(message.payloadHash).toBe('hash');
    expect(message.receivedAt).toBe(AT);
    expect(message.isProcessed()).toBe(false);
    expect(message.processedAt).toBeUndefined();
  });

  it('marks itself processed', () => {
    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-transactions',
      payloadHash: 'hash',
      receivedAt: AT,
    });
    message.markProcessed(AT);
    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toBe(AT);
  });

  it('rehydrates persisted state', () => {
    const message = InboxMessage.rehydrate({
      messageId: 'msg-1',
      consumerName: 'wager-transactions',
      payloadHash: 'hash',
      receivedAt: AT,
      processedAt: AT,
    });
    expect(message.isProcessed()).toBe(true);
  });
});
