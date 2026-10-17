import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import { AppModule } from '../../src/app.module';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

suite('observability (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('echoes a provided correlation id and generates one otherwise', async () => {
    const echo = await fetch(`${baseUrl}/health/live`, {
      headers: { 'x-correlation-id': 'my-corr' },
    });
    expect(echo.headers.get('x-correlation-id')).toBe('my-corr');

    const generated = await fetch(`${baseUrl}/health/live`);
    expect(generated.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('exposes metrics reflecting wagering activity, without authentication', async () => {
    const playerId = uuidv7();
    const walletResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await walletResponse.json()) as { id: string };

    const payload = {
      providerId: 'provider-a',
      externalTransactionId: uuidv7(),
      playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };
    const key = `provider-a:${uuidv7()}`;
    const headers = { 'content-type': 'application/json', 'idempotency-key': key };

    const first = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);

    const replay = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    expect(replay.status).toBe(200);

    const metricsResponse = await fetch(`${baseUrl}/metrics`);
    expect(metricsResponse.status).toBe(200);
    const metrics = await metricsResponse.text();

    expect(metrics).toContain('# TYPE wager_transactions_total counter');
    expect(metrics).toContain('wager_transactions_total{status="PROCESSED",kind="BET"} 1');
    expect(metrics).toContain('wager_idempotent_replays_total 1');
    expect(metrics).toContain('# TYPE outbox_lag_seconds gauge');
    expect(metrics).toContain('# TYPE wallet_lock_wait_seconds histogram');
  });
});
