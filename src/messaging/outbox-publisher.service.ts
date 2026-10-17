import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EventPublisher } from '../domain/messaging/event-publisher';
import type { UnitOfWork } from '../domain/unit-of-work';
import { UNIT_OF_WORK } from '../infrastructure/persistence/persistence.tokens';
import { MetricsService } from '../observability/metrics.service';
import { RequestContextStore } from '../observability/request-context';
import { EVENT_PUBLISHER } from './messaging.tokens';

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly enabled: boolean;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly leaseMs: number;
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    private readonly metrics: MetricsService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('OUTBOX_PUBLISHER_ENABLED') ?? false;
    this.batchSize = config.get<number>('OUTBOX_PUBLISHER_BATCH_SIZE') ?? 20;
    this.intervalMs = config.get<number>('OUTBOX_PUBLISHER_INTERVAL_MS') ?? 1000;
    this.leaseMs = config.get<number>('OUTBOX_LEASE_MS') ?? 30000;
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
    this.logger.log('Outbox publisher started');
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = undefined;
    this.logger.log('Outbox publisher stopped');
  }

  async publishOnce(now: Date = new Date()): Promise<number> {
    const leaseUntil = new Date(now.getTime() + this.leaseMs);
    const messages = await this.unitOfWork.run((repositories) =>
      repositories.outbox.claimDue({ now, leaseUntil, limit: this.batchSize }),
    );

    for (const message of messages) {
      const correlationId = String(message.payload['correlationId'] ?? message.id);
      try {
        await RequestContextStore.run({ correlationId }, () =>
          this.publisher.publish({
            eventId: message.id,
            eventType: message.eventType,
            aggregateId: message.aggregateId,
            payload: message.payload,
          }),
        );
        await this.unitOfWork.run((repositories) =>
          repositories.outbox.markPublished(message.id, new Date()),
        );
        this.metrics.outboxPublished();
      } catch (error) {
        this.logger.error(
          `Failed to publish outbox message ${message.id}: ${toMessage(error)}`,
        );
        this.metrics.outboxRetry();
        message.scheduleRetry(new Date());
        await this.unitOfWork.run((repositories) =>
          repositories.outbox.scheduleRetry(
            message.id,
            message.nextAttemptAt as Date,
            message.attempts,
          ),
        );
      }
    }

    await this.refreshLag();
    return messages.length;
  }

  private async refreshLag(): Promise<void> {
    const oldest = await this.unitOfWork.run((repositories) =>
      repositories.outbox.oldestPendingOccurredAt(),
    );
    const lagSeconds = oldest ? Math.max(0, (Date.now() - oldest.getTime()) / 1000) : 0;
    this.metrics.outboxLag(lagSeconds);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const claimed = await this.publishOnce();
        if (claimed === 0) {
          await sleep(this.intervalMs);
        }
      } catch (error) {
        this.logger.error(`Outbox publish cycle failed: ${toMessage(error)}`);
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
