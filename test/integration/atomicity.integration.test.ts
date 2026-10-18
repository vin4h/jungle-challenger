import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { InboxMessage } from '../../src/domain/messaging/inbox-message';
import { payloadHash } from '../../src/domain/shared/hash';
import type { Repositories, UnitOfWork } from '../../src/domain/unit-of-work';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/wager-transaction/enums';
import { UNIT_OF_WORK } from '../../src/infrastructure/persistence/persistence.tokens';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionInput,
} from '../../src/wagering/process-wager-transaction.use-case';
import { assertWalletMatchesLedger } from './support/ledger-consistency';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

interface WalletFixture {
  readonly id: string;
  readonly playerId: string;
}

interface LedgerCounts {
  readonly DEBIT: number;
  readonly CREDIT: number;
}

suite('transactional atomicity (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let unitOfWork: UnitOfWork;
  let useCase: ProcessWagerTransactionUseCase;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    dataSource = app.get(DataSource);
    unitOfWork = app.get<UnitOfWork>(UNIT_OF_WORK);
    useCase = app.get(ProcessWagerTransactionUseCase);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createWallet(amount = '100.00'): Promise<WalletFixture> {
    const playerId = uuidv7();
    const response = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount, currency: 'BRL' } }),
    });
    const wallet = (await response.json()) as { id: string };
    return { id: wallet.id, playerId };
  }

  function input(
    wallet: WalletFixture,
    kind: WagerTransactionKind,
    amount: string,
  ): ProcessWagerTransactionInput {
    const externalTransactionId = uuidv7();
    return {
      providerId: 'provider-a',
      externalTransactionId,
      idempotencyKey: `provider-a:${externalTransactionId}`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind,
      money: { amount, currency: 'BRL' },
    };
  }

  async function ledgerCounts(walletId: string): Promise<LedgerCounts> {
    const rows = await dataSource.query<Array<{ direction: string; count: number }>>(
      `SELECT direction, COUNT(*)::int AS count
         FROM wallet_ledger_entries
        WHERE wallet_id = $1
        GROUP BY direction`,
      [walletId],
    );
    return {
      DEBIT: rows.find((row) => row.direction === 'DEBIT')?.count ?? 0,
      CREDIT: rows.find((row) => row.direction === 'CREDIT')?.count ?? 0,
    };
  }

  async function outboxCount(walletId: string): Promise<number> {
    const rows = await dataSource.query<Array<{ count: number }>>(
      'SELECT COUNT(*)::int AS count FROM outbox_messages WHERE aggregate_id = $1',
      [walletId],
    );
    return rows[0]?.count ?? 0;
  }

  async function inboxCount(messageId: string): Promise<number> {
    const rows = await dataSource.query<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count
         FROM inbox_messages
        WHERE consumer_name = $1 AND message_id = $2`,
      ['atomicity-test', messageId],
    );
    return rows[0]?.count ?? 0;
  }

  function inboxFor(messageId: string): InboxMessage {
    return InboxMessage.receive({
      messageId,
      consumerName: 'atomicity-test',
      payloadHash: payloadHash({ messageId }),
      receivedAt: new Date(),
    });
  }

  it('commits wallet, transaction, ledger, inbox and outbox in one transaction', async () => {
    const wallet = await createWallet();
    const messageId = uuidv7();
    const inbox = inboxFor(messageId);

    const outcome = await unitOfWork.run(async (repositories: Repositories) => {
      expect(await repositories.inbox.tryInsert(inbox)).toBe(true);
      const result = await useCase.executeWithin(
        repositories,
        input(wallet, WagerTransactionKind.Bet, '25.00'),
      );
      await repositories.inbox.markProcessed('atomicity-test', messageId, new Date());
      return result;
    });

    expect(outcome.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(await ledgerCounts(wallet.id)).toEqual({ DEBIT: 1, CREDIT: 1 });
    expect(await outboxCount(wallet.id)).toBe(2);
    expect(await inboxCount(messageId)).toBe(1);

    const wallets = await dataSource.query<Array<{ balance_amount: string }>>(
      'SELECT balance_amount FROM wallets WHERE id = $1',
      [wallet.id],
    );
    expect(wallets[0]?.balance_amount).toBe('75.00');
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  it('rolls back wallet, ledger, inbox and outbox when the transaction fails', async () => {
    const wallet = await createWallet();
    const messageId = uuidv7();
    const inbox = inboxFor(messageId);

    await expect(
      unitOfWork.run(async (repositories: Repositories) => {
        expect(await repositories.inbox.tryInsert(inbox)).toBe(true);
        await useCase.executeWithin(
          repositories,
          input(wallet, WagerTransactionKind.Bet, '25.00'),
        );
        await repositories.inbox.markProcessed('atomicity-test', messageId, new Date());
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    const wallets = await dataSource.query<Array<{ balance_amount: string; version: number }>>(
      'SELECT balance_amount, version FROM wallets WHERE id = $1',
      [wallet.id],
    );
    expect(wallets[0]?.balance_amount).toBe('100.00');
    expect(wallets[0]?.version).toBe(1);

    expect(await ledgerCounts(wallet.id)).toEqual({ DEBIT: 0, CREDIT: 1 });
    expect(await outboxCount(wallet.id)).toBe(0);
    expect(await inboxCount(messageId)).toBe(0);
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });
});
