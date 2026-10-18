import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { WalletAlreadyExistsError } from '../domain/errors/wallet-already-exists.error';
import { WalletNotFoundError } from '../domain/errors/wallet-not-found.error';
import { Money } from '../domain/money/money';
import { payloadHash } from '../domain/shared/hash';
import type { UnitOfWork } from '../domain/unit-of-work';
import type { LedgerEntriesPage, ListLedgerEntriesOptions } from '../domain/wallet/wallet.repository';
import { Wallet } from '../domain/wallet/wallet';
import { WagerTransaction } from '../domain/wager-transaction/wager-transaction';
import { UNIT_OF_WORK } from '../infrastructure/persistence/persistence.tokens';
import { MetricsService } from '../observability/metrics.service';

export interface CreateWalletInput {
  readonly playerId: string;
  readonly initialBalance: { readonly amount: string; readonly currency: string };
}

export interface ReconciliationResult {
  readonly walletId: string;
  readonly storedBalance: Money;
  readonly calculatedBalance: Money;
  readonly difference: Money;
  readonly consistent: boolean;
  readonly checkedEntries: number;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    private readonly metrics: MetricsService,
  ) {}

  async createWallet(input: CreateWalletInput): Promise<Wallet> {
    const initialBalance = Money.from(input.initialBalance);
    const occurredAt = new Date();
    const walletId = uuidv7();

    return this.unitOfWork.run(async ({ wallets, transactions }) => {
      const existing = await wallets.findByPlayerIdAndCurrency(input.playerId, initialBalance.currency);
      if (existing) {
        throw new WalletAlreadyExistsError(input.playerId, initialBalance.currency);
      }

      const openingTransactionId = uuidv7();
      const openingLedgerEntryId = uuidv7();
      const opening = initialBalance.isPositive()
        ? { transactionId: openingTransactionId, ledgerEntryId: openingLedgerEntryId }
        : undefined;

      const wallet = Wallet.open({
        id: walletId,
        playerId: input.playerId,
        initialBalance,
        occurredAt,
        opening,
      });

      await wallets.insert(wallet);

      const ledgerEntries = wallet.pullLedgerEntries();
      if (ledgerEntries.length > 0) {
        await transactions.insert(
          WagerTransaction.open({
            id: openingTransactionId,
            walletId: wallet.id,
            playerId: wallet.playerId,
            idempotencyKey: `opening:${wallet.id}`,
            payloadHash: payloadHash({
              kind: 'OPENING',
              walletId: wallet.id,
              money: initialBalance.toJSON(),
            }),
            money: initialBalance,
            occurredAt,
          }),
        );
        await wallets.insertLedgerEntries(ledgerEntries);
      }

      return wallet;
    });
  }

  async getWallet(walletId: string): Promise<Wallet> {
    return this.unitOfWork.run(async ({ wallets }) => {
      const wallet = await wallets.findById(walletId);
      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }
      return wallet;
    });
  }

  async getLedger(
    walletId: string,
    options: ListLedgerEntriesOptions,
  ): Promise<LedgerEntriesPage> {
    return this.unitOfWork.run(async ({ wallets }) => {
      const wallet = await wallets.findById(walletId);
      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }
      return wallets.listLedgerEntries(walletId, options);
    });
  }

  async reconcile(walletId: string): Promise<ReconciliationResult> {
    return this.unitOfWork.run(async ({ wallets }) => {
      const wallet = await wallets.findById(walletId);
      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }

      const { balanceAmount, entries } = await wallets.sumLedger(walletId);
      const calculatedBalance = Money.rehydrate({
        amount: balanceAmount,
        currency: wallet.currency,
      });
      const difference = wallet.balance.subtract(calculatedBalance);
      const consistent = difference.isZero();

      if (!consistent) {
        this.metrics.reconciliationDivergence();
        this.logger.warn(
          `Wallet ${walletId} is inconsistent: stored=${wallet.balance.toString()} ledger=${calculatedBalance.toString()}`,
        );
      }

      return {
        walletId,
        storedBalance: wallet.balance,
        calculatedBalance,
        difference,
        consistent,
        checkedEntries: entries,
      };
    });
  }
}
