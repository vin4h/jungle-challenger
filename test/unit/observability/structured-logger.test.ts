import { describe, expect, it, spyOn } from 'bun:test';
import { ConfigService } from '@nestjs/config';
import { RequestContextStore } from '../../../src/observability/request-context';
import { StructuredLogger } from '../../../src/observability/structured-logger';

function capture(run: () => void): string[] {
  const writes: string[] = [];
  const stdout = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  const stderr = spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    run();
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return writes;
}

function logger(config: Record<string, unknown>): StructuredLogger {
  return new StructuredLogger(new ConfigService(config));
}

describe('StructuredLogger', () => {
  it('emits one-line JSON merging the request context and fields', () => {
    const instance = logger({ LOG_LEVEL: 'debug', LOG_PRETTY: false });
    const writes = capture(() =>
      RequestContextStore.run({ correlationId: 'corr-1', messageId: 'msg-1' }, () =>
        instance.event('info', 'settled', { walletId: 'w-1' }),
      ),
    );

    expect(writes).toHaveLength(1);
    const record = JSON.parse(writes[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'info',
      msg: 'settled',
      correlationId: 'corr-1',
      messageId: 'msg-1',
      walletId: 'w-1',
    });
    expect(typeof record.time).toBe('string');
    expect(writes[0]!.trim().split('\n')).toHaveLength(1);
  });

  it('filters levels below the configured minimum', () => {
    const instance = logger({ LOG_LEVEL: 'warn', LOG_PRETTY: false });
    expect(capture(() => instance.event('info', 'ignored'))).toHaveLength(0);
    expect(capture(() => instance.event('warn', 'kept'))).toHaveLength(1);
  });

  it('includes Nest context passed as the last string argument', () => {
    const instance = logger({ LOG_LEVEL: 'debug', LOG_PRETTY: false });
    const writes = capture(() => instance.log('booted', 'Bootstrap'));
    const record = JSON.parse(writes[0]!) as Record<string, unknown>;
    expect(record.context).toBe('Bootstrap');
  });
});
