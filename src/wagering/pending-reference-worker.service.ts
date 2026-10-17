import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UnitOfWork } from '../domain/unit-of-work';
import type { WagerTransaction } from '../domain/wager-transaction/wager-transaction';
import { WagerTransactionStatus } from '../domain/wager-transaction/enums';
import { UNIT_OF_WORK } from '../infrastructure/persistence/persistence.tokens';
import { MetricsService } from '../observability/metrics.service';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case';

@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private readonly enabled: boolean;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    private readonly useCase: ProcessWagerTransactionUseCase,
    private readonly metrics: MetricsService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('PENDING_REFERENCE_WORKER_ENABLED') ?? false;
    this.batchSize = config.get<number>('PENDING_REFERENCE_BATCH_SIZE') ?? 20;
    this.intervalMs = config.get<number>('PENDING_REFERENCE_INTERVAL_MS') ?? 5000;
  }

  onModuleInit(): void {
    if (this.enabled) {
      this.start();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.logger.log('Pending-reference worker started');
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = undefined;
    this.logger.log('Pending-reference worker stopped');
  }

  async runOnce(now: Date = new Date()): Promise<number> {
    const due = await this.unitOfWork.run((repositories) =>
      repositories.transactions.listDuePendingReferences(now, this.batchSize),
    );

    let settled = 0;
    for (const transaction of due) {
      settled += await this.resume(transaction, now);
    }
    return settled;
  }

  private async resume(transaction: WagerTransaction, now: Date): Promise<number> {
    return this.unitOfWork.run(async (repositories) => {
      const lockStartedAt = Date.now();
      const wallet = await repositories.wallets.findById(transaction.walletId, { forUpdate: true });
      this.metrics.walletLockWait((Date.now() - lockStartedAt) / 1000);
      if (!wallet) {
        return 0;
      }
      const current = await repositories.transactions.findById(transaction.id);
      if (!current || current.status !== WagerTransactionStatus.PendingReference) {
        return 0;
      }
      await this.useCase.resumePendingReferenceWithin(repositories, current, wallet, now);
      return 1;
    });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const settled = await this.runOnce();
        if (settled === 0) {
          await sleep(this.intervalMs);
        }
      } catch (error) {
        this.logger.error(`Pending-reference cycle failed: ${toMessage(error)}`);
        await sleep(this.intervalMs);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
