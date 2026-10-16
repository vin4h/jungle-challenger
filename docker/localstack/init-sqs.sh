#!/bin/sh
# Runs once LocalStack is ready. Creates the FIFO queues required by the challenge.
#
# NOTE: ContentBasedDeduplication is intentionally DISABLED. Deduplication is a
# persistence concern (inbox table), not a broker guarantee — see README section 5.3
# and section 10. The producer must always send an explicit MessageDeduplicationId.
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

create_fifo_queue "wager-transactions.fifo"
create_fifo_queue "wager-transactions-dlq.fifo"

DLQ_URL=$(${AWSLOCAL} sqs get-queue-url --queue-name "wager-transactions-dlq.fifo" --region "${REGION}" --query 'QueueUrl' --output text)
DLQ_ARN=$(${AWSLOCAL} sqs get-queue-attributes --queue-url "${DLQ_URL}" --region "${REGION}" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# Wire the redrive policy: messages move to the DLQ after maxReceiveCount receives.
${AWSLOCAL} sqs set-queue-attributes \
  --queue-url "$(${AWSLOCAL} sqs get-queue-url --queue-name "wager-transactions.fifo" --region "${REGION}" --query 'QueueUrl' --output text)" \
  --region "${REGION}" \
  --attributes "{\"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}"

echo "[init-sqs] queues ready:"
${AWSLOCAL} sqs list-queues --region "${REGION}"
