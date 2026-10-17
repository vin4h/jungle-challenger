import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

suite('health endpoints (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health/live returns 200', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns 200 when PostgreSQL and SQS are reachable', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; checks: Record<string, { up: boolean }> };
    expect(body.status).toBe('ok');
    expect(body.checks.postgres?.up).toBe(true);
    expect(body.checks.sqs?.up).toBe(true);
  });
});
