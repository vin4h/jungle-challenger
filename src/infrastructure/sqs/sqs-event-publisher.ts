import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { Inject, Injectable } from '@nestjs/common';
import type { EventPublisher, EventToPublish } from '../../domain/messaging/event-publisher';
import { SQS_CLIENT, SQS_QUEUES, type SqsQueueUrls } from './sqs.tokens';

@Injectable()
export class SqsEventPublisher implements EventPublisher {
  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(SQS_QUEUES) private readonly queues: SqsQueueUrls,
  ) {}

  async publish(event: EventToPublish): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queues.events,
        MessageBody: JSON.stringify(event.payload),
        MessageGroupId: event.aggregateId,
        MessageDeduplicationId: event.eventId,
      }),
    );
  }
}
