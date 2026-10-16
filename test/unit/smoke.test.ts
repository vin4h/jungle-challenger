import { describe, expect, it } from 'bun:test';

describe('test harness', () => {
  it('runs with typescript and decorators available', () => {
    expect(1 + 1).toBe(2);
  });
});
