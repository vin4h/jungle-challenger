import { CurrencyMismatchError } from '../errors/currency-mismatch.error';
import { InvalidWalletStateError } from '../errors/invalid-wallet-state.error';
import { InsufficientFundsError } from '../errors/insufficient-funds.error';
import { Money } from '../money/money';
import { LedgerDirection } from './ledger-direction';
import { WalletLedgerEntry } from './wallet-ledger-entry';

export interface LedgerMovementContext {
  readonly ledgerEntryId: string;
  readonly transactionId: string;
  readonly occurredAt: Date;
}

export interface OpenWalletProps {
  readonly id: string;
  readonly playerId: string;
  readonly initialBalance: Money;
  readonly occurredAt: Date;
  readonly opening?: {
    readonly transactionId: string;
    readonly ledgerEntryId: string;
  };
}

export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Wallet {
  private readonly newLedgerEntries: WalletLedgerEntry[] = [];

  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new InvalidWalletStateError('initial balance cannot be negative');
    }

    const wallet = new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      Money.zero(props.initialBalance.currency),
      1,
      props.occurredAt,
      props.occurredAt,
    );

    if (props.initialBalance.isPositive()) {
      if (!props.opening) {
        throw new InvalidWalletStateError('a positive initial balance requires an OPENING transaction');
      }
      wallet.applyMovement(LedgerDirection.Credit, props.initialBalance, {
        ledgerEntryId: props.opening.ledgerEntryId,
        transactionId: props.opening.transactionId,
        occurredAt: props.occurredAt,
      }, false);
    }

    return wallet;
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(money: Money, context: LedgerMovementContext): WalletLedgerEntry {
    return this.applyMovement(LedgerDirection.Debit, money, context, true);
  }

  credit(money: Money, context: LedgerMovementContext): WalletLedgerEntry {
    return this.applyMovement(LedgerDirection.Credit, money, context, true);
  }

  pullLedgerEntries(): WalletLedgerEntry[] {
    const entries = [...this.newLedgerEntries];
    this.newLedgerEntries.length = 0;
    return entries;
  }

  private applyMovement(
    direction: LedgerDirection,
    money: Money,
    context: LedgerMovementContext,
    incrementVersion: boolean,
  ): WalletLedgerEntry {
    this.assertSameCurrency(money);
    if (!money.isPositive()) {
      throw new InvalidWalletStateError('movement amount must be positive');
    }

    const balanceBefore = this._balance;
    const balanceAfter =
      direction === LedgerDirection.Credit
        ? balanceBefore.add(money)
        : balanceBefore.subtract(money);

    if (balanceAfter.isNegative()) {
      throw new InsufficientFundsError(balanceBefore.toString(), money.toString(), this.currency);
    }

    const entry = WalletLedgerEntry.create({
      id: context.ledgerEntryId,
      walletId: this.id,
      transactionId: context.transactionId,
      direction,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: context.occurredAt,
    });

    this._balance = balanceAfter;
    this._updatedAt = context.occurredAt;
    if (incrementVersion) {
      this._version += 1;
    }
    this.newLedgerEntries.push(entry);
    return entry;
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
