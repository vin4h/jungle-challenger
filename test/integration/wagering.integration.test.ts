import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';

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

suite('wagering (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createWallet(amount = '100.00', currency = 'BRL'): Promise<WalletFixture> {
    const playerId = uuidv7();
    const response = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount, currency } }),
    });
    const wallet = (await response.json()) as { id: string };
    return { id: wallet.id, playerId };
  }

  function body(
    wallet: WalletFixture,
    kind: string,
    amount: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      providerId: 'provider-a',
      externalTransactionId: uuidv7(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind,
      money: { amount, currency: 'BRL' },
      ...overrides,
    };
  }

  async function submit(
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (idempotencyKey) {
      headers['idempotency-key'] = idempotencyKey;
    }
    return fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  async function balance(walletId: string): Promise<string> {
    const response = await fetch(`${baseUrl}/wallets/${walletId}`);
    const wallet = (await response.json()) as { balance: { amount: string } };
    return wallet.balance.amount;
  }

  async function ledgerCounts(walletId: string): Promise<LedgerCounts> {
    const rows = await dataSource.query<Array<{ direction: string; count: number }>>(
      `SELECT direction, count(*)::int AS count
       FROM wallet_ledger_entries WHERE wallet_id = $1 GROUP BY direction`,
      [walletId],
    );
    const debit = rows.find((row) => row.direction === 'DEBIT')?.count ?? 0;
    const credit = rows.find((row) => row.direction === 'CREDIT')?.count ?? 0;
    return { DEBIT: debit, CREDIT: credit };
  }

  async function outboxEvents(walletId: string): Promise<string[]> {
    const rows = await dataSource.query<Array<{ event_type: string }>>(
      'SELECT event_type FROM outbox_messages WHERE aggregate_id = $1 ORDER BY event_type',
      [walletId],
    );
    return rows.map((row) => row.event_type);
  }

  it('processes a BET: debits, records one ledger entry and enqueues events', async () => {
    const wallet = await createWallet('100.00');
    const response = await submit(body(wallet, 'BET', '25.00'));

    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      transactionId: string;
      status: string;
      balance: { amount: string };
      idempotentReplay: boolean;
    };
    expect(result.status).toBe('PROCESSED');
    expect(result.balance.amount).toBe('75.00');
    expect(result.idempotentReplay).toBe(false);

    expect(await balance(wallet.id)).toBe('75.00');
    expect(await ledgerCounts(wallet.id)).toEqual({ DEBIT: 1, CREDIT: 1 });
    expect(await outboxEvents(wallet.id)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
  });

  it('rejects a BET with insufficient funds without touching the ledger', async () => {
    const wallet = await createWallet('10.00');
    const response = await submit(body(wallet, 'BET', '25.00'));

    expect(response.status).toBe(422);
    const result = (await response.json()) as { status: string; failureCode: string; balance: { amount: string } };
    expect(result.status).toBe('REJECTED');
    expect(result.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(result.balance.amount).toBe('10.00');
    expect(await balance(wallet.id)).toBe('10.00');
    expect(await ledgerCounts(wallet.id)).toEqual({ DEBIT: 0, CREDIT: 1 });
    expect(await outboxEvents(wallet.id)).toEqual(['WagerTransactionRejected']);
  });

  it('processes a WIN as a credit', async () => {
    const wallet = await createWallet('100.00');
    const response = await submit(body(wallet, 'WIN', '50.00'));
    expect(response.status).toBe(201);
    const result = (await response.json()) as { status: string; balance: { amount: string } };
    expect(result.status).toBe('PROCESSED');
    expect(result.balance.amount).toBe('150.00');
    expect(await ledgerCounts(wallet.id)).toEqual({ DEBIT: 0, CREDIT: 2 });
  });

  it('processes a LOSS without a ledger entry or balance change', async () => {
    const wallet = await createWallet('100.00');
    const response = await submit(body(wallet, 'LOSS', '5.00'));
    expect(response.status).toBe(201);
    const result = (await response.json()) as { status: string; balance: { amount: string } };
    expect(result.status).toBe('PROCESSED');
    expect(result.balance.amount).toBe('100.00');
    expect(await ledgerCounts(wallet.id)).toEqual({ DEBIT: 0, CREDIT: 1 });
    expect(await outboxEvents(wallet.id)).toEqual(['WagerTransactionProcessed']);
  });

  it('replays an identical request without duplicating effects', async () => {
    const wallet = await createWallet('100.00');
    const key = `provider-a:${uuidv7()}`;
    const payload = body(wallet, 'BET', '30.00');

    const first = await submit(payload, key);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { transactionId: string };

    const second = await submit(payload, key);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      transactionId: string;
      idempotentReplay: boolean;
      balance: { amount: string };
    };
    expect(secondBody.idempotentReplay).toBe(true);
    expect(secondBody.transactionId).toBe(firstBody.transactionId);
    expect(secondBody.balance.amount).toBe('70.00');
    expect(await ledgerCounts(wallet.id)).toEqual({ DEBIT: 1, CREDIT: 1 });
  });

  it('rejects reusing an idempotency key with a different payload', async () => {
    const wallet = await createWallet('100.00');
    const key = `provider-a:${uuidv7()}`;
    expect((await submit(body(wallet, 'BET', '10.00'), key)).status).toBe(201);

    const conflict = await submit(body(wallet, 'BET', '20.00'), key);
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { code: string }).code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('refunds a BET exactly once', async () => {
    const wallet = await createWallet('100.00');
    const externalId = uuidv7();
    const bet = await submit(body(wallet, 'BET', '40.00', { externalTransactionId: externalId }));
    expect(bet.status).toBe(201);
    expect(await balance(wallet.id)).toBe('60.00');

    const refundBody = body(wallet, 'REFUND', '40.00', {
      referenceExternalTransactionId: externalId,
    });
    const refund = await submit(refundBody);
    expect(refund.status).toBe(201);
    expect(((await refund.json()) as { status: string }).status).toBe('PROCESSED');
    expect(await balance(wallet.id)).toBe('100.00');

    const secondRefund = await submit(
      body(wallet, 'REFUND', '40.00', { referenceExternalTransactionId: externalId }),
    );
    expect(secondRefund.status).toBe(422);
    expect(((await secondRefund.json()) as { failureCode: string }).failureCode).toBe(
      'ALREADY_REVERSED',
    );
  });

  it('rejects a ROLLBACK that would produce a negative balance', async () => {
    const wallet = await createWallet('100.00');
    const winExternalId = uuidv7();
    expect((await submit(body(wallet, 'WIN', '50.00', { externalTransactionId: winExternalId }))).status).toBe(201);
    expect(await balance(wallet.id)).toBe('150.00');
    expect((await submit(body(wallet, 'BET', '150.00'))).status).toBe(201);
    expect(await balance(wallet.id)).toBe('0.00');

    const rollback = await submit(
      body(wallet, 'ROLLBACK', '50.00', { referenceExternalTransactionId: winExternalId }),
    );
    expect(rollback.status).toBe(422);
    const result = (await rollback.json()) as { failureCode: string; status: string };
    expect(result.status).toBe('REJECTED');
    expect(result.failureCode).toBe('REVERSAL_WOULD_GO_NEGATIVE');
  });

  it('keeps a reversal pending when the reference has not arrived', async () => {
    const wallet = await createWallet('100.00');
    const response = await submit(
      body(wallet, 'REFUND', '10.00', { referenceExternalTransactionId: uuidv7() }),
    );
    expect(response.status).toBe(202);
    const result = (await response.json()) as { status: string; balance: { amount: string } };
    expect(result.status).toBe('PENDING_REFERENCE');
    expect(result.balance.amount).toBe('100.00');
    expect(await outboxEvents(wallet.id)).toEqual(['WagerTransactionPendingReference']);
  });

  it('settles the mandatory scenario: two concurrent 80.00 bets on a 100.00 balance', async () => {
    const wallet = await createWallet('100.00');
    const [a, b] = await Promise.all([
      submit(body(wallet, 'BET', '80.00')),
      submit(body(wallet, 'BET', '80.00')),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 422]);
    expect(await balance(wallet.id)).toBe('20.00');
    expect(await ledgerCounts(wallet.id)).toEqual({ DEBIT: 1, CREDIT: 1 });
  });

  it('applies a duplicated bet only once under parallel delivery', async () => {
    const wallet = await createWallet('100.00');
    const key = `provider-a:${uuidv7()}`;
    const payload = body(wallet, 'BET', '25.00');

    const responses = await Promise.all(Array.from({ length: 10 }, () => submit(payload, key)));
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.every((status) => status === 200 || status === 201)).toBe(true);
    expect(await ledgerCounts(wallet.id)).toEqual({ DEBIT: 1, CREDIT: 1 });
    expect(await balance(wallet.id)).toBe('75.00');
  });

  it('exposes transactions by id and by provider external id', async () => {
    const wallet = await createWallet('100.00');
    const externalId = uuidv7();
    const created = await submit(body(wallet, 'BET', '10.00', { externalTransactionId: externalId }));
    const { transactionId } = (await created.json()) as { transactionId: string };

    const byId = await fetch(`${baseUrl}/wagering/transactions/${transactionId}`);
    expect(byId.status).toBe(200);

    const byExternal = await fetch(
      `${baseUrl}/providers/provider-a/wagering/transactions/${externalId}`,
    );
    expect(byExternal.status).toBe(200);
    expect(((await byExternal.json()) as { transactionId: string }).transactionId).toBe(
      transactionId,
    );

    expect((await fetch(`${baseUrl}/wagering/transactions/${uuidv7()}`)).status).toBe(404);
  });
});
