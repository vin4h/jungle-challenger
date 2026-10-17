import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { CorrelationMiddleware } from './correlation.middleware';
import { MetricsController } from './metrics.controller';
import { MetricsRegistry } from './metrics.registry';
import { MetricsService } from './metrics.service';
import { StructuredLogger } from './structured-logger';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsRegistry, MetricsService, StructuredLogger],
  exports: [MetricsService, StructuredLogger],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
