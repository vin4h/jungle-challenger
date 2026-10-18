import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer } from 'node:net';
import { v7 as uuidv7 } from 'uuid';
import { DataSource } from 'typeorm';
import { assertWalletMatchesLedger } from './support/ledger-consistency';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

interface WalletFixture {
  readonly id: string;
  readonly playerId: string;
}

type ChildProcess = ReturnType<typeof Bun.spawn>;

suite('multi-instance (integration)', () => {
  const children: ChildProcess[] = [];
  const baseUrls: string[] = [];
  let dataSource: DataSource;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for the multi-instance integration test');
    }

    for (let index = 0; index < 3; index += 1) {
      const port = await freePort();
      baseUrls.push(`http://127.0.0.1:${port}`);

      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
      Object.assign(env, {
        PORT: String(port),
        AUTH_ENABLED: 'false',
        SQS_CONSUMER_ENABLED: 'false',
        OUTBOX_PUBLISHER_ENABLED: 'false',
        PENDING_REFERENCE_WORKER_ENABLED: 'false',
      });

      children.push(
        Bun.spawn(['bun', 'run', 'src/main.ts'], {
          cwd: process.cwd(),
          env,
          stdout: 'ignore',
          stderr: 'pipe',
        }),
      );
    }

    await Promise.all(baseUrls.map((baseUrl) => waitForHealth(baseUrl)));

    dataSource = new DataSource({ type: 'postgres', url: databaseUrl });
    await dataSource.initialize();
  }, 40_000);

  afterAll(async () => {
    for (const child of children) {
      child.kill();
    }
    await Promise.all(children.map((child) => child.exited.catch(() => undefined)));
    await dataSource?.destroy();
  });

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

  async function submitBet(
    baseUrl: string,
    wallet: WalletFixture,
    amount: string,
    options: { idempotencyKey?: string; externalTransactionId?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }

    return fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        providerId: 'provider-a',
        externalTransactionId: options.externalTransactionId ?? uuidv7(),
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount, currency: 'BRL' },
      }),
    });
  }

  async function balance(baseUrl: string, walletId: string): Promise<string> {
    const response = await fetch(`${baseUrl}/wallets/${walletId}`);
    const wallet = (await response.json()) as { balance: { amount: string } };
    return wallet.balance.amount;
  }

  async function debitCount(walletId: string): Promise<number> {
    const rows = await dataSource.query<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count
         FROM wallet_ledger_entries
        WHERE wallet_id = $1 AND direction = 'DEBIT'`,
      [walletId],
    );
    return rows[0]?.count ?? 0;
  }

  it('serializes concurrent bets across three independent processes', async () => {
    const wallet = await createWallet(baseUrls[0]!, '100.00');

    const responses = await Promise.all(
      baseUrls.map((baseUrl) => submitBet(baseUrl, wallet, '80.00')),
    );
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([201, 422, 422]);
    expect(await balance(baseUrls[0]!, wallet.id)).toBe('20.00');
    expect(await debitCount(wallet.id)).toBe(1);
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });

  it('deduplicates the same idempotency key across instances', async () => {
    const wallet = await createWallet(baseUrls[0]!, '100.00');
    const externalTransactionId = uuidv7();
    const idempotencyKey = `provider-a:${externalTransactionId}`;

    const responses = await Promise.all(
      baseUrls.map((baseUrl) =>
        submitBet(baseUrl, wallet, '10.00', { idempotencyKey, externalTransactionId }),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([200, 200, 201]);
    expect(await balance(baseUrls[0]!, wallet.id)).toBe('90.00');
    expect(await debitCount(wallet.id)).toBe(1);
    await assertWalletMatchesLedger(dataSource, wallet.id);
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('could not allocate a free port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health/live`);
      if (response.ok) {
        return;
      }
    } catch {
      // processo ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`instance did not become healthy: ${baseUrl}`);
}
