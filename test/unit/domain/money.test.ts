import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError } from '../../../src/domain/errors/currency-mismatch.error';
import { InvalidMoneyError } from '../../../src/domain/errors/invalid-money.error';
import { Money } from '../../../src/domain/money/money';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

describe('Money', () => {
  describe('from', () => {
    it('normalizes the amount to a fixed scale of 2', () => {
      expect(brl('25').toString()).toBe('25.00');
      expect(brl('25.5').toString()).toBe('25.50');
      expect(brl('25.00').toString()).toBe('25.00');
      expect(brl('0').toString()).toBe('0.00');
    });

    it('normalizes the currency to upper case', () => {
      expect(Money.from({ amount: '1.00', currency: 'brl' }).currency).toBe('BRL');
    });

    it.each([
      ['empty string', ''],
      ['whitespace', ' 1.00 '],
      ['letters', 'abc'],
      ['scientific notation', '1e3'],
      ['NaN', 'NaN'],
      ['Infinity', 'Infinity'],
      ['more than 2 decimals', '1.005'],
      ['3 decimals', '25.123'],
      ['negative', '-1.00'],
      ['explicit sign', '+1.00'],
      ['leading dot', '.50'],
      ['trailing dot', '1.'],
      ['digit grouping', '1,000.00'],
      ['too many integer digits', '10000000000000000'],
    ])('rejects %s', (_label, amount) => {
      expect(() => brl(amount)).toThrow(InvalidMoneyError);
    });

    it('rejects non-string amounts (never accepts a JS number)', () => {
      expect(() => Money.from({ amount: 25 as unknown as string, currency: 'BRL' })).toThrow(
        InvalidMoneyError,
      );
    });

    it('rejects invalid currency codes', () => {
      expect(() => Money.from({ amount: '1.00', currency: 'BR' })).toThrow(InvalidMoneyError);
      expect(() => Money.from({ amount: '1.00', currency: 'BRLL' })).toThrow(InvalidMoneyError);
    });
  });

  describe('arithmetic', () => {
    it('adds decimal strings exactly (no floating point artifacts)', () => {
      expect(brl('0.10').add(brl('0.20')).toString()).toBe('0.30');
      expect(brl('0.10').add(brl('0.20')).equals(brl('0.30'))).toBe(true);
    });

    it('subtracts exactly', () => {
      expect(brl('100.00').subtract(brl('80.00')).toString()).toBe('20.00');
    });

    it('subtraction may yield a negative value (arithmetic, not an input contract)', () => {
      expect(brl('5.00').subtract(brl('10.00')).toString()).toBe('-5.00');
      expect(brl('5.00').subtract(brl('10.00')).isNegative()).toBe(true);
    });

    it('negates', () => {
      expect(brl('12.34').negate().toString()).toBe('-12.34');
    });

    it('rejects results that overflow NUMERIC(18,2) instead of silently rounding', () => {
      expect(() => brl('9999999999999999.99').add(brl('0.01'))).toThrow(InvalidMoneyError);
    });
  });

  describe('predicates', () => {
    it('classifies sign', () => {
      expect(brl('0.00').isZero()).toBe(true);
      expect(brl('0.01').isPositive()).toBe(true);
      expect(brl('0.00').isPositive()).toBe(false);
      expect(brl('0.00').subtract(brl('0.01')).isNegative()).toBe(true);
    });

    it('compares amounts', () => {
      expect(brl('1.00').isLessThan(brl('2.00'))).toBe(true);
      expect(brl('2.00').isGreaterThanOrEqualTo(brl('2.00'))).toBe(true);
      expect(brl('2.00').equals(brl('2.00'))).toBe(true);
      expect(brl('2.00').equals(brl('2.01'))).toBe(false);
    });
  });

  describe('currency safety', () => {
    it('throws on operations between different currencies', () => {
      const usd = Money.from({ amount: '1.00', currency: 'USD' });
      expect(() => brl('1.00').add(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl('1.00').subtract(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl('1.00').equals(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl('1.00').isLessThan(usd)).toThrow(CurrencyMismatchError);
    });
  });

  describe('serialization', () => {
    it('round-trips through toJSON', () => {
      expect(brl('1234.5').toJSON()).toEqual({ amount: '1234.50', currency: 'BRL' });
    });

    it('rehydrates persisted values without applying input rules', () => {
      const money = Money.rehydrate({ amount: '1000.00', currency: 'BRL' });
      expect(money.toString()).toBe('1000.00');
      expect(money.currency).toBe('BRL');
    });
  });

  it('does not expose division or multiplication (single currency, scale 2)', () => {
    const money = brl('10.00') as unknown as Record<string, unknown>;
    expect(money['divide']).toBeUndefined();
    expect(money['multiply']).toBeUndefined();
  });
});
