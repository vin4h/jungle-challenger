import 'reflect-metadata';

process.env.AUTH_ENABLED = 'false';
process.env.SQS_CONSUMER_ENABLED = 'false';
process.env.SQS_CONSUMER_WAIT_SECONDS = '1';
process.env.PENDING_REFERENCE_MAX_ATTEMPTS = '2';
