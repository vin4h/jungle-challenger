import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import type { EventPublisher } from '../../src/domain/messaging/event-publisher';
import type { UnitOfWork } from '../../src/domain/unit-of-work';
import { UNIT_OF_WORK } from '../../src/infrastructure/persistence/persistence.tokens';
import { SQS_CLIENT, SQS_QUEUES, type SqsQueueUrls } from '../../src/infrastructure/sqs/sqs.tokens';
import { EVENT_PUBLISHER } from '../../src/messaging/messaging.tokens';
import { OutboxPublisher } from '../../src/messaging/outbox-publisher.service';
import { MetricsService } from '../../src/observability/metrics.service';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

interface ReceivedEvent {
  readonly body: string;
  readonly groupId: string | undefined;
}

suite('outbox publisher (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let sqs: SQSClient;
  let queues: SqsQueueUrls;
  let publisher: OutboxPublisher;
  let unitOfWork: UnitOfWork;
  let eventPublisher: EventPublisher;
  let config: ConfigService;
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
    publisher = app.get(OutboxPublisher);
    unitOfWork = app.get(UNIT_OF_WORK);
    eventPublisher = app.get(EVENT_PUBLISHER);
    config = app.get(ConfigService);

    for (let i = 0; i < 20; i += 1) {
      const claimed = await publisher.publishOnce();
      if (claimed === 0) {
        break;
      }
    }
    await drain(queues.events);
  });

  afterAll(async () => {
    await publisher?.stop();
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

  async function receiveEvents(): Promise<ReceivedEvent[]> {
    const received: ReceivedEvent[] = [];
    for (let i = 0; i < 10; i += 1) {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queues.events,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          MessageSystemAttributeNames: ['MessageGroupId'],
        }),
      );
      const messages = response.Messages ?? [];
      if (messages.length === 0) {
        break;
      }
      for (const message of messages) {
        received.push({ body: message.Body ?? '', groupId: message.Attributes?.MessageGroupId });
        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: queues.events, ReceiptHandle: message.ReceiptHandle! }),
        );
      }
    }
    return received;
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

  async function submitBet(wallet: { id: string; playerId: string }, amount = '10.00'): Promise<void> {
    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'provider-a',
        externalTransactionId: uuidv7(),
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount, currency: 'BRL' },
      }),
    });
    expect(response.status).toBe(201);
  }

  async function pendingFor(walletId: string): Promise<number> {
    const rows = await dataSource.query<Array<{ count: number }>>(
      'SELECT count(*)::int AS count FROM outbox_messages WHERE aggregate_id = $1 AND published_at IS NULL',
      [walletId],
    );
    return rows[0]?.count ?? 0;
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

  function eventsOf(received: ReceivedEvent[], walletId: string): Array<Record<string, unknown>> {
    return received
      .map((event) => JSON.parse(event.body) as Record<string, unknown>)
      .filter((event) => event.aggregateId === walletId);
  }

  it('publishes pending events to the events queue and marks them published', async () => {
    const wallet = await createWallet('100.00');
    await submitBet(wallet);
    expect(await pendingFor(wallet.id)).toBe(2);

    await publisher.publishOnce();
    await waitFor(async () => ((await pendingFor(wallet.id)) === 0 ? true : null));

    const received = await receiveEvents();
    const events = eventsOf(received, wallet.id);
    expect(events.map((event) => event.eventType).sort()).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
    expect(received.find((event) => event.body.includes(wallet.id))?.groupId).toBe(wallet.id);
  });

  it('does not lose events when two publishers run concurrently', async () => {
    const wallet = await createWallet('1000.00');
    for (let i = 0; i < 3; i += 1) {
      await submitBet(wallet, '10.00');
    }
    expect(await pendingFor(wallet.id)).toBe(6);

    const second = new OutboxPublisher(unitOfWork, eventPublisher, app.get(MetricsService), config);
    await Promise.all([
      publisher.publishOnce(),
      second.publishOnce(),
      publisher.publishOnce(),
      second.publishOnce(),
    ]);

    await waitFor(async () => ((await pendingFor(wallet.id)) === 0 ? true : null));
    const events = eventsOf(await receiveEvents(), wallet.id);
    expect(events).toHaveLength(6);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(6);
  });

  it('republishes after the lease expires when a publisher dies mid-flight', async () => {
    const wallet = await createWallet('100.00');
    await submitBet(wallet);

    const claimed = await unitOfWork.run((repositories) =>
      repositories.outbox.claimDue({
        now: new Date(),
        leaseUntil: new Date(Date.now() + 30_000),
        limit: 100,
      }),
    );
    expect(claimed.filter((message) => message.aggregateId === wallet.id)).toHaveLength(2);

    await publisher.publishOnce(new Date());
    expect(await pendingFor(wallet.id)).toBe(2);

    await publisher.publishOnce(new Date(Date.now() + 31_000));
    await waitFor(async () => ((await pendingFor(wallet.id)) === 0 ? true : null));
    expect(eventsOf(await receiveEvents(), wallet.id)).toHaveLength(2);
  });
});
