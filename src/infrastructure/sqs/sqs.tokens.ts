export const SQS_CLIENT = 'SQS_CLIENT';
export const SQS_QUEUES = 'SQS_QUEUES';

export interface SqsQueueUrls {
  readonly wager: string;
  readonly wagerDlq: string;
}
