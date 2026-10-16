import { SQSClient } from '@aws-sdk/client-sqs';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQS_CLIENT, SQS_QUEUES, type SqsQueueUrls } from './sqs.tokens';

/**
 * Provides a shared SQS client and the resolved queue URLs.
 *
 * The client is configured for LocalStack/MiniStack locally via `SQS_ENDPOINT`;
 * in a real AWS environment the endpoint is omitted and the SDK resolves it.
 */
@Global()
@Module({
  providers: [
    {
      provide: SQS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SQSClient => {
        const endpoint = config.get<string>('SQS_ENDPOINT');
        return new SQSClient({
          region: config.getOrThrow<string>('AWS_REGION'),
          ...(endpoint ? { endpoint } : {}),
          credentials: {
            accessKeyId: config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
            secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
          },
        });
      },
    },
    {
      provide: SQS_QUEUES,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SqsQueueUrls => ({
        wager: config.getOrThrow<string>('SQS_WAGER_QUEUE_URL'),
        wagerDlq: config.getOrThrow<string>('SQS_WAGER_DLQ_URL'),
      }),
    },
  ],
  exports: [SQS_CLIENT, SQS_QUEUES],
})
export class SqsModule {}
