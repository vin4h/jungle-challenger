import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { assertWalletMatchesLedger } from './support/ledger-consistency';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

suite('wallets (integration)', () => {
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

  async function createWallet(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('creates a wallet with an OPENING transaction and one CREDIT ledger entry', async () => {
    const playerId = uuidv7();
    const response = await createWallet({
      playerId,
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    expect(response.status).toBe(201);
    const wallet = (await response.json()) as {
      id: string;
      playerId: string;
      balance: { amount: string; currency: string };
      version: number;
    };
    expect(wallet.balance).toEqual({ amount: '1000.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);

    const ledger = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger`);
    expect(ledger.status).toBe(200);
    const page = (await ledger.json()) as {
      entries: Array<{ direction: string; money: { amount: string }; balanceBefore: { amount: string }; balanceAfter: { amount: string } }>;
      nextCursor: string | null;
    };
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]!.direction).toBe('CREDIT');
    expect(page.entries[0]!.balanceBefore.amount).toBe('0.00');
    expect(page.entries[0]!.balanceAfter.amount).toBe('1000.00');
    expect(page.nextCursor).toBeNull();

    const persisted = await dataSource.query<Array<{ kind: string; status: string }>>(
      'SELECT kind, status FROM wager_transactions WHERE wallet_id = $1',
      [wallet.id],
    );
    expect(persisted).toEqual([{ kind: 'OPENING', status: 'PROCESSED' }]);
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  it('creates a wallet with a zero balance and no ledger entry', async () => {
    const response = await createWallet({
      playerId: uuidv7(),
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });
    expect(response.status).toBe(201);
    const wallet = (await response.json()) as { id: string };

    const ledger = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger`);
    const page = (await ledger.json()) as { entries: unknown[] };
    expect(page.entries).toHaveLength(0);
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  it('rejects a duplicate playerId + currency with 409', async () => {
    const playerId = uuidv7();
    const body = { playerId, initialBalance: { amount: '10.00', currency: 'BRL' } };
    const first = await createWallet(body);
    expect(first.status).toBe(201);
    const wallet = (await first.json()) as { id: string };
    expect((await createWallet(body)).status).toBe(409);
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  it('allows the same player in a different currency', async () => {
    const playerId = uuidv7();
    const brl = await createWallet({
      playerId,
      initialBalance: { amount: '10.00', currency: 'BRL' },
    });
    expect(brl.status).toBe(201);
    const brlWallet = (await brl.json()) as { id: string };
    const usd = await createWallet({
      playerId,
      initialBalance: { amount: '10.00', currency: 'USD' },
    });
    expect(usd.status).toBe(201);
    const usdWallet = (await usd.json()) as { id: string };
    expect(
      (await createWallet({ playerId, initialBalance: { amount: '10.00', currency: 'BRL' } })).status,
    ).toBe(409);
    await assertWalletMatchesLedger(dataSource, brlWallet.id);
    await assertWalletMatchesLedger(dataSource, usdWallet.id);
  });

  it('returns 404 for an unknown wallet', async () => {
    expect((await fetch(`${baseUrl}/wallets/${uuidv7()}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/wallets/${uuidv7()}/ledger`)).status).toBe(404);
  });

  it('rejects malformed money with 400', async () => {
    const response = await createWallet({
      playerId: uuidv7(),
      initialBalance: { amount: '1.234', currency: 'BRL' },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('INVALID_MONEY');
  });

  it('paginates the ledger with a stable opaque cursor', async () => {
    const response = await createWallet({
      playerId: uuidv7(),
      initialBalance: { amount: '500.00', currency: 'BRL' },
    });
    const wallet = (await response.json()) as { id: string; playerId: string };

    const extraTransactionId = uuidv7();
    await dataSource.query(
      `INSERT INTO wager_transactions
         (id, kind, status, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, amount, currency, processed_at, created_at)
       VALUES ($1, 'WIN', 'PROCESSED', 'provider-test', $2, $3, 'hash',
          $4, $5, 'round-test', 'game-test', '5.00', 'BRL', now(), now())`,
      [extraTransactionId, `ext-${extraTransactionId}`, `test:${extraTransactionId}`, wallet.id, wallet.playerId],
    );
    await dataSource.query(
      `INSERT INTO wallet_ledger_entries
         (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
       VALUES ($1, $2, $3, 'CREDIT', '5.00', 'BRL', '500.00', '505.00', now() + interval '1 second')`,
      [uuidv7(), wallet.id, extraTransactionId],
    );
    // Mantém o saldo materializado coerente com o lançamento inserido à mão.
    await dataSource.query('UPDATE wallets SET balance_amount = $1 WHERE id = $2', [
      '505.00',
      wallet.id,
    ]);

    const first = (await (
      await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=1`)
    ).json()) as { entries: Array<{ id: string }>; nextCursor: string | null };
    expect(first.entries).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = (await (
      await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=1&cursor=${first.nextCursor}`)
    ).json()) as { entries: Array<{ id: string }>; nextCursor: string | null };
    expect(second.entries).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const replay = (await (
      await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=1&cursor=${first.nextCursor}`)
    ).json()) as { entries: Array<{ id: string }> };
    expect(replay.entries[0]!.id).toBe(second.entries[0]!.id);
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  describe('schema guarantees', () => {
    it('rejects a negative balance at the database level', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
           VALUES ($1, $2, 'BRL', -1.00, 1, now(), now())`,
          [uuidv7(), uuidv7()],
        ),
      ).rejects.toThrow(/ck_wallets_balance_non_negative/);
    });

    it('forbids updating or deleting ledger entries', async () => {
      const response = await createWallet({
        playerId: uuidv7(),
        initialBalance: { amount: '10.00', currency: 'BRL' },
      });
      const wallet = (await response.json()) as { id: string };

      await expect(
        dataSource.query('UPDATE wallet_ledger_entries SET amount = 1.00 WHERE wallet_id = $1', [
          wallet.id,
        ]),
      ).rejects.toThrow(/append-only/);

      await expect(
        dataSource.query('DELETE FROM wallet_ledger_entries WHERE wallet_id = $1', [wallet.id]),
      ).rejects.toThrow(/append-only/);
      await assertWalletMatchesLedger(dataSource, wallet.id);
    });
  });
});
