import Decimal from 'decimal.js';
import { CurrencyMismatchError } from '../errors/currency-mismatch.error';
import { InvalidMoneyError } from '../errors/invalid-money.error';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Currency = string;

export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}

const SCALE = 2;
const MAX_MAGNITUDE = new Decimal('1e16');
const AMOUNT_PATTERN = /^\d{1,16}(?:\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: Currency,
  ) {
    assertRepresentable(value);
  }

  static from(props: MoneyProps): Money {
    return new Money(parseInputAmount(props.amount), normalizeCurrency(props.currency));
  }

  static zero(currency: Currency): Money {
    return new Money(new Decimal(0), normalizeCurrency(currency));
  }

  static rehydrate(props: MoneyProps): Money {
    return new Money(parsePersistedAmount(props.amount), normalizeCurrency(props.currency));
  }

  get amount(): string {
    return this.toString();
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.add(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.sub(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  isLessThanOrEqualTo(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThanOrEqualTo(other.value);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  isGreaterThanOrEqualTo(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThanOrEqualTo(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  toString(): string {
    return this.value.toFixed(SCALE);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

function normalizeCurrency(input: unknown): Currency {
  if (typeof input !== 'string') {
    throw new InvalidMoneyError('currency must be a string');
  }
  const currency = input.toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new InvalidMoneyError(`"${input}" is not a valid ISO-4217 currency code`);
  }
  return currency;
}

function parseInputAmount(input: unknown): Decimal {
  if (typeof input !== 'string') {
    throw new InvalidMoneyError('amount must be a decimal string');
  }
  if (!AMOUNT_PATTERN.test(input)) {
    throw new InvalidMoneyError(
      `"${input}" must be a non-negative decimal string with at most ${SCALE} decimal places`,
    );
  }
  return new Decimal(input);
}

function parsePersistedAmount(input: unknown): Decimal {
  if (typeof input !== 'string') {
    throw new InvalidMoneyError('persisted amount must be a decimal string');
  }
  let value: Decimal;
  try {
    value = new Decimal(input);
  } catch {
    throw new InvalidMoneyError(`"${input}" is not a valid decimal amount`);
  }
  if (!value.isFinite()) {
    throw new InvalidMoneyError('persisted amount must be finite');
  }
  return value;
}

function assertRepresentable(value: Decimal): void {
  if (value.decimalPlaces() > SCALE) {
    throw new InvalidMoneyError(`value has more than ${SCALE} decimal places`);
  }
  if (value.abs().greaterThanOrEqualTo(MAX_MAGNITUDE)) {
    throw new InvalidMoneyError('value exceeds the supported range (NUMERIC(18,2))');
  }
}
