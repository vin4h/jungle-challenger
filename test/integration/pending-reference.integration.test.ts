import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { PendingReferenceWorker } from '../../src/wagering/pending-reference-worker.service';
import { assertWalletMatchesLedger } from './support/ledger-consistency';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

const BACKOFF_MS = 30_000;

suite('pending reference and reconciliation (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let worker: PendingReferenceWorker;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    dataSource = app.get(DataSource);
    worker = app.get(PendingReferenceWorker);
  });

  afterAll(async () => {
    await app?.close();
  });

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

  async function submit(
    wallet: { id: string; playerId: string },
    kind: string,
    amount: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ status: number; body: { transactionId: string; status: string; failureCode?: string } }> {
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
    return { status: response.status, body: (await response.json()) as never };
  }

  async function balance(walletId: string): Promise<string> {
    const response = await fetch(`${baseUrl}/wallets/${walletId}`);
    const wallet = (await response.json()) as { balance: { amount: string } };
    return wallet.balance.amount;
  }

  async function statusOf(transactionId: string): Promise<{ status: string; failureCode?: string }> {
    const rows = await dataSource.query<Array<{ status: string; failure_code: string | null }>>(
      'SELECT status, failure_code FROM wager_transactions WHERE id = $1',
      [transactionId],
    );
    return { status: rows[0]!.status, failureCode: rows[0]!.failure_code ?? undefined };
  }

  async function attemptsOf(transactionId: string): Promise<number> {
    const rows = await dataSource.query<Array<{ reference_attempts: number }>>(
      'SELECT reference_attempts FROM wager_transactions WHERE id = $1',
      [transactionId],
    );
    return rows[0]!.reference_attempts;
  }

  async function outboxEvents(walletId: string): Promise<string[]> {
    const rows = await dataSource.query<Array<{ event_type: string }>>(
      'SELECT event_type FROM outbox_messages WHERE aggregate_id = $1',
      [walletId],
    );
    return rows.map((row) => row.event_type);
  }

  it('settles a pending REFUND once the referenced BET arrives', async () => {
    const wallet = await createWallet('100.00');
    const referenceExternalId = uuidv7();

    const refund = await submit(wallet, 'REFUND', '30.00', {
      referenceExternalTransactionId: referenceExternalId,
    });
    expect(refund.status).toBe(202);
    expect(refund.body.status).toBe('PENDING_REFERENCE');

    const bet = await submit(wallet, 'BET', '30.00', {
      externalTransactionId: referenceExternalId,
    });
    expect(bet.status).toBe(201);
    expect(await balance(wallet.id)).toBe('70.00');

    expect(await worker.runOnce(new Date())).toBeGreaterThanOrEqual(1);
    expect((await statusOf(refund.body.transactionId)).status).toBe('PROCESSED');
    expect(await balance(wallet.id)).toBe('100.00');
    expect(await outboxEvents(wallet.id)).toContain('WagerTransactionProcessed');
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  it('does not retry before the next attempt is due', async () => {
    const wallet = await createWallet('100.00');
    const refund = await submit(wallet, 'REFUND', '10.00', {
      referenceExternalTransactionId: uuidv7(),
    });

    const now = new Date();
    await worker.runOnce(now);
    expect(await attemptsOf(refund.body.transactionId)).toBe(1);

    const settled = await worker.runOnce(now);
    expect(settled).toBe(0);
    expect(await attemptsOf(refund.body.transactionId)).toBe(1);
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  it('rejects with REFERENCE_NOT_FOUND after exhausting attempts', async () => {
    const wallet = await createWallet('100.00');
    const refund = await submit(wallet, 'REFUND', '10.00', {
      referenceExternalTransactionId: uuidv7(),
    });

    const now = new Date();
    await worker.runOnce(now);
    await worker.runOnce(new Date(now.getTime() + BACKOFF_MS + 1_000));

    const state = await statusOf(refund.body.transactionId);
    expect(state.status).toBe('REJECTED');
    expect(state.failureCode).toBe('REFERENCE_NOT_FOUND');
    expect(await outboxEvents(wallet.id)).toContain('WagerTransactionRejected');
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  it('reports a consistent wallet', async () => {
    const wallet = await createWallet('100.00');
    const response = await fetch(`${baseUrl}/wallets/${wallet.id}/reconciliation`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      walletId: string;
      storedBalance: { amount: string; currency: string };
      calculatedBalance: { amount: string; currency: string };
      difference: { amount: string; currency: string };
      consistent: boolean;
      checkedEntries: number;
    };
    expect(body).toEqual({
      walletId: wallet.id,
      storedBalance: { amount: '100.00', currency: 'BRL' },
      calculatedBalance: { amount: '100.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    });
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  it('flags a divergence without correcting it', async () => {
    const wallet = await createWallet('100.00');
    await dataSource.query('UPDATE wallets SET balance_amount = 999.99 WHERE id = $1', [wallet.id]);

    const response = await fetch(`${baseUrl}/wallets/${wallet.id}/reconciliation`, {
      method: 'POST',
    });
    const body = (await response.json()) as {
      calculatedBalance: { amount: string };
      difference: { amount: string };
      consistent: boolean;
    };
    expect(body.consistent).toBe(false);
    expect(body.calculatedBalance.amount).toBe('100.00');
    expect(body.difference.amount).toBe('899.99');

    // Este teste corrompe o saldo de propósito; a invariante wallet == ledger não se aplica.
    expect(await balance(wallet.id)).toBe('999.99');
  });
});
