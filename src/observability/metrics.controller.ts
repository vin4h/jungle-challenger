import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../infrastructure/auth/public.decorator';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  private readonly enabled: boolean;

  constructor(
    private readonly metrics: MetricsService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('METRICS_ENABLED') ?? true;
  }

  @Public()
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  render(): string {
    if (!this.enabled) {
      throw new NotFoundException();
    }
    return this.metrics.render();
  }
}
