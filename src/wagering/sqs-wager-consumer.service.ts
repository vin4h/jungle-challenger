import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainError } from '../domain/errors/domain-error';
import { InboxMessage } from '../domain/messaging/inbox-message';
import { payloadHash } from '../domain/shared/hash';
import type { UnitOfWork } from '../domain/unit-of-work';
import { WagerTransactionKind } from '../domain/wager-transaction/enums';
import { UNIT_OF_WORK } from '../infrastructure/persistence/persistence.tokens';
import { SQS_CLIENT, SQS_QUEUES, type SqsQueueUrls } from '../infrastructure/sqs/sqs.tokens';
import type { ProcessWagerTransactionInput } from './process-wager-transaction.use-case';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case';
import { wagerTransactionMessageSchema, type WagerTransactionMessage } from './wager-message.schema';

export const WAGER_CONSUMER_NAME = 'wager-transactions';

@Injectable()
export class SqsWagerConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SqsWagerConsumer.name);
  private readonly enabled: boolean;
  private readonly maxMessages: number;
  private readonly waitSeconds: number;
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(SQS_QUEUES) private readonly queues: SqsQueueUrls,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    private readonly useCase: ProcessWagerTransactionUseCase,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('SQS_CONSUMER_ENABLED') ?? false;
    this.maxMessages = config.get<number>('SQS_CONSUMER_MAX_MESSAGES') ?? 10;
    this.waitSeconds = config.get<number>('SQS_CONSUMER_WAIT_SECONDS') ?? 20;
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
    this.logger.log('Wager queue consumer started');
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = undefined;
    this.logger.log('Wager queue consumer stopped');
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queues.wager,
            MaxNumberOfMessages: this.maxMessages,
            WaitTimeSeconds: this.waitSeconds,
            MessageSystemAttributeNames: ['MessageGroupId'],
          }),
        );

        for (const message of response.Messages ?? []) {
          if (!this.running) {
            break;
          }
          await this.handleMessageSafely(message);
        }
      } catch (error) {
        this.logger.error(`Receive loop failed: ${toMessage(error)}`);
        await sleep(1_000);
      }
    }
  }

  private async handleMessageSafely(message: Message): Promise<void> {
    try {
      await this.handleMessage(message);
    } catch (error) {
      this.logger.error(
        `Deferring message ${message.MessageId ?? 'unknown'} for redelivery: ${toMessage(error)}`,
      );
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    const receiptHandle = message.ReceiptHandle;
    if (!receiptHandle) {
      return;
    }

    const body = message.Body ?? '';
    let parsed: WagerTransactionMessage;
    try {
      parsed = wagerTransactionMessageSchema.parse(JSON.parse(body));
    } catch {
      this.logger.warn(`Moving malformed message ${message.MessageId ?? 'unknown'} to the DLQ`);
      await this.sendToDlq(message);
      await this.deleteMessage(receiptHandle);
      return;
    }

    try {
      await this.process(parsed);
      await this.deleteMessage(receiptHandle);
    } catch (error) {
      if (error instanceof DomainError) {
        this.logger.warn(`Rejecting message ${parsed.messageId}: ${error.code}`);
        await this.deleteMessage(receiptHandle);
        return;
      }
      throw error;
    }
  }

  private async process(message: WagerTransactionMessage): Promise<void> {
    const receivedAt = new Date();
    const hash = payloadHash(message.data);

    await this.unitOfWork.run(async (repositories) => {
      const inbox = InboxMessage.receive({
        messageId: message.messageId,
        consumerName: WAGER_CONSUMER_NAME,
        payloadHash: hash,
        receivedAt,
      });

      const inserted = await repositories.inbox.tryInsert(inbox);
      if (!inserted) {
        this.logger.debug(`Skipping duplicate message ${message.messageId}`);
        return;
      }

      await this.useCase.executeWithin(repositories, toInput(message));
      await repositories.inbox.markProcessed(WAGER_CONSUMER_NAME, message.messageId, new Date());
    });
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({ QueueUrl: this.queues.wager, ReceiptHandle: receiptHandle }),
    );
  }

  private async sendToDlq(message: Message): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queues.wagerDlq,
        MessageBody: message.Body ?? '',
        MessageGroupId: message.Attributes?.MessageGroupId ?? 'unroutable',
        MessageDeduplicationId: message.MessageId ?? `${WAGER_CONSUMER_NAME}:${Date.now()}`,
      }),
    );
  }
}

function toInput(message: WagerTransactionMessage): ProcessWagerTransactionInput {
  return {
    providerId: message.data.providerId,
    externalTransactionId: message.data.externalTransactionId,
    idempotencyKey:
      message.data.idempotencyKey ??
      `${message.data.providerId}:${message.data.externalTransactionId}`,
    playerId: message.data.playerId,
    walletId: message.data.walletId,
    roundId: message.data.roundId,
    gameId: message.data.gameId,
    kind: message.data.kind as WagerTransactionKind,
    money: message.data.money,
    referenceExternalTransactionId: message.data.referenceExternalTransactionId,
    correlationId: message.messageId,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
