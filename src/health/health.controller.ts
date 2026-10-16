import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { Public } from '../infrastructure/auth/public.decorator';
import { SQS_CLIENT, SQS_QUEUES, type SqsQueueUrls } from '../infrastructure/sqs/sqs.tokens';

interface DependencyCheck {
  readonly up: boolean;
  readonly error?: string;
}

interface ReadinessResponse {
  readonly status: 'ok' | 'error';
  readonly checks: {
    readonly postgres: DependencyCheck;
    readonly sqs: DependencyCheck;
  };
}

/**
 * Liveness and readiness probes (README section 9 / 12).
 *
 * - `live`    : the process is up. No dependencies are touched.
 * - `ready`   : PostgreSQL and SQS are reachable. Returns 503 when either is down.
 *
 * Both are public (no authentication), as required by README section 2.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(SQS_QUEUES) private readonly queues: SqsQueueUrls,
  ) {}

  @Public()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<ReadinessResponse> {
    const [postgres, sqs] = await Promise.all([this.checkPostgres(), this.checkSqs()]);
    const body: ReadinessResponse = {
      status: postgres.up && sqs.up ? 'ok' : 'error',
      checks: { postgres, sqs },
    };

    if (body.status === 'error') {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async checkPostgres(): Promise<DependencyCheck> {
    try {
      await this.dataSource.query('SELECT 1');
      return { up: true };
    } catch (error) {
      return { up: false, error: toMessage(error) };
    }
  }

  private async checkSqs(): Promise<DependencyCheck> {
    try {
      await this.sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queues.wager,
          AttributeNames: ['QueueArn'],
        }),
      );
      return { up: true };
    } catch (error) {
      return { up: false, error: toMessage(error) };
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
