#!/bin/sh
set -eu

AWSLOCAL="awslocal"
REGION="us-east-1"

echo "[init-sqs] region=${REGION}"

create_fifo_queue() {
  name="$1"
  ${AWSLOCAL} sqs create-queue \
    --queue-name "${name}" \
    --region "${REGION}" \
    --attributes '{
      "FifoQueue": "true",
      "ContentBasedDeduplication": "false",
      "VisibilityTimeout": "60",
      "MessageRetentionPeriod": "1209600",
      "ReceiveMessageWaitTimeSeconds": "20"
    }' >/dev/null
}

queue_url() {
  ${AWSLOCAL} sqs get-queue-url --queue-name "$1" --region "${REGION}" --query 'QueueUrl' --output text
}

queue_arn() {
  ${AWSLOCAL} sqs get-queue-attributes \
    --queue-url "$(queue_url "$1")" \
    --region "${REGION}" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text
}

set_redrive() {
  main="$1"
  dlq="$2"
  ${AWSLOCAL} sqs set-queue-attributes \
    --queue-url "$(queue_url "${main}")" \
    --region "${REGION}" \
    --attributes "{\"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$(queue_arn "${dlq}")\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}"
}

create_fifo_queue "wager-transactions.fifo"
create_fifo_queue "wager-transactions-dlq.fifo"
create_fifo_queue "wager-events.fifo"
create_fifo_queue "wager-events-dlq.fifo"

set_redrive "wager-transactions.fifo" "wager-transactions-dlq.fifo"
set_redrive "wager-events.fifo" "wager-events-dlq.fifo"

echo "[init-sqs] queues ready:"
${AWSLOCAL} sqs list-queues --region "${REGION}"
