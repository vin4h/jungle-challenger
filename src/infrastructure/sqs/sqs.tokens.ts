/** DI tokens for the SQS infrastructure. */
export const SQS_CLIENT = 'SQS_CLIENT';
export const SQS_QUEUES = 'SQS_QUEUES';

/** Queue URLs resolved from configuration. */
export interface SqsQueueUrls {
  readonly wager: string;
  readonly wagerDlq: string;
}
