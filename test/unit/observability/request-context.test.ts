import { describe, expect, it } from 'bun:test';
import { RequestContextStore } from '../../../src/observability/request-context';

describe('RequestContextStore', () => {
  it('exposes the current context', () => {
    expect(RequestContextStore.current()).toBeUndefined();

    RequestContextStore.run({ correlationId: 'c1' }, () => {
      expect(RequestContextStore.correlationId()).toBe('c1');
      expect(RequestContextStore.messageId()).toBeUndefined();
    });

    expect(RequestContextStore.current()).toBeUndefined();
  });

  it('keeps nested contexts isolated', () => {
    RequestContextStore.run({ correlationId: 'outer' }, () => {
      RequestContextStore.run({ correlationId: 'inner', messageId: 'm1' }, () => {
        expect(RequestContextStore.correlationId()).toBe('inner');
        expect(RequestContextStore.messageId()).toBe('m1');
      });
      expect(RequestContextStore.correlationId()).toBe('outer');
    });
  });
});
