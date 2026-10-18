import { describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { OutboxPublisher } from '../../src/messaging/outbox-publisher.service';
import { PendingReferenceWorker } from '../../src/wagering/pending-reference-worker.service';
import { assertWalletMatchesLedger } from './support/ledger-consistency';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

interface WalletFixture {
  readonly id: string;
  readonly playerId: string;
}

interface StartedApp {
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly dataSource: DataSource;
}

interface SubmitResult {
  readonly status: number;
  readonly body: {
    transactionId: string;
    status: string;
    failureCode?: string;
  };
}

suite('restart recovery (integration)', () => {
  async function startApp(): Promise<StartedApp> {
    const app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    return {
      app,
      baseUrl: await app.getUrl(),
      dataSource: app.get(DataSource),
    };
  }

  async function createWallet(baseUrl: string, amount = '100.00'): Promise<WalletFixture> {
    const playerId = uuidv7();
    const response = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount, currency: 'BRL' } }),
    });
    const wallet = (await response.json()) as { id: string };
    return { id: wallet.id, playerId };
  }

  async function submit(
    baseUrl: string,
    wallet: WalletFixture,
    kind: string,
    amount: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SubmitResult> {
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
        kind,
        money: { amount, currency: 'BRL' },
        ...overrides,
      }),
    });
    return { status: response.status, body: (await response.json()) as SubmitResult['body'] };
  }

  async function balance(baseUrl: string, walletId: string): Promise<string> {
    const response = await fetch(`${baseUrl}/wallets/${walletId}`);
    const wallet = (await response.json()) as { balance: { amount: string } };
    return wallet.balance.amount;
  }

  async function pendingOutbox(dataSource: DataSource, walletId: string): Promise<number> {
    const rows = await dataSource.query<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count
         FROM outbox_messages
        WHERE aggregate_id = $1 AND published_at IS NULL`,
      [walletId],
    );
    return rows[0]?.count ?? 0;
  }

  it('resumes a PENDING_REFERENCE after restart', async () => {
    const referenceExternalId = uuidv7();
    const first = await startApp();
    let wallet!: WalletFixture;
    let refundId!: string;

    try {
      wallet = await createWallet(first.baseUrl);
      const refund = await submit(first.baseUrl, wallet, 'REFUND', '30.00', {
        referenceExternalTransactionId: referenceExternalId,
      });
      expect(refund.status).toBe(202);
      expect(refund.body.status).toBe('PENDING_REFERENCE');
      refundId = refund.body.transactionId;
    } finally {
      await first.app.close();
    }

    const second = await startApp();
    try {
      const worker = second.app.get(PendingReferenceWorker);
      expect(await worker.runOnce(new Date())).toBeGreaterThanOrEqual(1);

      const pendingRows = await second.dataSource.query<
        Array<{ reference_attempts: number }>
      >('SELECT reference_attempts FROM wager_transactions WHERE id = $1', [refundId]);
      expect(pendingRows[0]?.reference_attempts).toBe(1);

      const bet = await submit(second.baseUrl, wallet, 'BET', '30.00', {
        externalTransactionId: referenceExternalId,
      });
      expect(bet.status).toBe(201);

      // Avança além do backoff para o worker encontrar a referência já persistida.
      expect(await worker.runOnce(new Date(Date.now() + 31_000))).toBeGreaterThanOrEqual(1);

      const settled = await fetch(
        `${second.baseUrl}/wagering/transactions/${refundId}`,
      ).then((response) => response.json() as Promise<{ status: string }>);
      expect(settled.status).toBe('PROCESSED');
      expect(await balance(second.baseUrl, wallet.id)).toBe('100.00');
      await assertWalletMatchesLedger(second.dataSource, wallet.id);
    } finally {
      await second.app.close();
    }
  });

  it('drains pending outbox events after restart', async () => {
    const first = await startApp();
    let wallet!: WalletFixture;

    try {
      wallet = await createWallet(first.baseUrl);
      const bet = await submit(first.baseUrl, wallet, 'BET', '25.00');
      expect(bet.status).toBe(201);
      expect(await pendingOutbox(first.dataSource, wallet.id)).toBe(2);
    } finally {
      await first.app.close();
    }

    const second = await startApp();
    try {
      const publisher = second.app.get(OutboxPublisher);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if ((await pendingOutbox(second.dataSource, wallet.id)) === 0) {
          break;
        }
        await publisher.publishOnce();
      }

      expect(await pendingOutbox(second.dataSource, wallet.id)).toBe(0);
      const rows = await second.dataSource.query<Array<{ published_at: Date | null }>>(
        'SELECT published_at FROM outbox_messages WHERE aggregate_id = $1',
        [wallet.id],
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.published_at !== null)).toBe(true);
      await assertWalletMatchesLedger(second.dataSource, wallet.id);
    } finally {
      await second.app.close();
    }
  });

  it('keeps wallet and ledger consistent across a restart', async () => {
    const first = await startApp();
    let wallet!: WalletFixture;

    try {
      wallet = await createWallet(first.baseUrl);
      expect((await submit(first.baseUrl, wallet, 'BET', '25.00')).status).toBe(201);
      expect((await submit(first.baseUrl, wallet, 'WIN', '50.00')).status).toBe(201);
    } finally {
      await first.app.close();
    }

    const second = await startApp();
    try {
      expect(await balance(second.baseUrl, wallet.id)).toBe('125.00');

      const rows = await second.dataSource.query<Array<{ direction: string; count: number }>>(
        `SELECT direction, COUNT(*)::int AS count
           FROM wallet_ledger_entries
          WHERE wallet_id = $1
          GROUP BY direction`,
        [wallet.id],
      );
      const counts = {
        DEBIT: rows.find((row) => row.direction === 'DEBIT')?.count ?? 0,
        CREDIT: rows.find((row) => row.direction === 'CREDIT')?.count ?? 0,
      };
      expect(counts).toEqual({ DEBIT: 1, CREDIT: 2 });
      await assertWalletMatchesLedger(second.dataSource, wallet.id);
    } finally {
      await second.app.close();
    }
  });
});
