import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { SQS_CLIENT, SQS_QUEUES, type SqsQueueUrls } from '../../src/infrastructure/sqs/sqs.tokens';
import {
  SqsWagerConsumer,
  WAGER_CONSUMER_NAME,
} from '../../src/wagering/sqs-wager-consumer.service';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

suite('wager queue consumer (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let sqs: SQSClient;
  let queues: SqsQueueUrls;
  let consumer: SqsWagerConsumer;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    dataSource = app.get(DataSource);
    sqs = app.get(SQS_CLIENT);
    queues = app.get(SQS_QUEUES);
    consumer = app.get(SqsWagerConsumer);

    await drain(queues.wager);
    await drain(queues.wagerDlq);
    consumer.start();
  });

  afterAll(async () => {
    await consumer?.stop();
    await app?.close();
  });

  async function drain(queueUrl: string): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      const response = await sqs.send(
        new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 0 }),
      );
      const messages = response.Messages ?? [];
      if (messages.length === 0) {
        return;
      }
      for (const message of messages) {
        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle! }),
        );
      }
    }
  }

  async function createWallet(amount = '100.00'): Promise<{ id: string; playerId: string }> {
    const playerId = uuidv7();
    const response = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount, currency: 'BRL' } }),
    });
    const wallet = (await response.json()) as { id: string };
    return { id: wallet.id, playerId };
  }

  async function send(body: unknown, deduplicationId: string): Promise<void> {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queues.wager,
        MessageBody: typeof body === 'string' ? body : JSON.stringify(body),
        MessageGroupId: 'group-1',
        MessageDeduplicationId: deduplicationId,
      }),
    );
  }

  function envelope(
    messageId: string,
    wallet: { id: string; playerId: string },
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-a',
        externalTransactionId: uuidv7(),
        idempotencyKey: uuidv7(),
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
        ...overrides,
      },
    };
  }

  async function balance(walletId: string): Promise<string> {
    const response = await fetch(`${baseUrl}/wallets/${walletId}`);
    const wallet = (await response.json()) as { balance: { amount: string } };
    return wallet.balance.amount;
  }

  async function debitCount(walletId: string): Promise<number> {
    const rows = await dataSource.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM wallet_ledger_entries WHERE wallet_id = $1 AND direction = 'DEBIT'`,
      [walletId],
    );
    return rows[0]?.count ?? 0;
  }

  async function outboxEvents(walletId: string): Promise<string[]> {
    const rows = await dataSource.query<Array<{ event_type: string }>>(
      'SELECT event_type FROM outbox_messages WHERE aggregate_id = $1 ORDER BY event_type',
      [walletId],
    );
    return rows.map((row) => row.event_type);
  }

  async function inboxProcessed(messageId: string): Promise<boolean> {
    const rows = await dataSource.query<Array<{ processed_at: Date | null }>>(
      'SELECT processed_at FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2',
      [WAGER_CONSUMER_NAME, messageId],
    );
    return rows.length > 0 && rows[0]!.processed_at !== null;
  }

  async function dlqDepth(): Promise<number> {
    const response = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queues.wagerDlq,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    return Number(response.Attributes?.ApproximateNumberOfMessages ?? '0');
  }

  async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await check();
      if (value) {
        return value as T;
      }
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for condition');
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  it('processes a queued BET through the same use case', async () => {
    const wallet = await createWallet('100.00');
    const messageId = uuidv7();

    await send(envelope(messageId, wallet), uuidv7());

    await waitFor(() => inboxProcessed(messageId));
    expect(await balance(wallet.id)).toBe('75.00');
    expect(await debitCount(wallet.id)).toBe(1);
    expect(await outboxEvents(wallet.id)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
  });

  it('deduplicates by messageId without applying the effect twice', async () => {
    const wallet = await createWallet('100.00');
    const messageId = uuidv7();

    await send(envelope(messageId, wallet), uuidv7());
    await waitFor(() => inboxProcessed(messageId));
    await send(envelope(messageId, wallet), uuidv7());

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await debitCount(wallet.id)).toBe(1);
    expect(await balance(wallet.id)).toBe('75.00');
  });

  it('moves a malformed message to the DLQ', async () => {
    const before = await dlqDepth();
    await send('not-a-valid-envelope', uuidv7());
    await waitFor(async () => (await dlqDepth()) > before);
    expect(await dlqDepth()).toBeGreaterThan(before);
  });

  it('stops gracefully', async () => {
    await consumer.stop();
    expect(true).toBe(true);
  });
});
