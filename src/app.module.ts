import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { AuthGuard } from './infrastructure/auth/auth.guard';
import { AuthModule } from './infrastructure/auth/auth.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { SqsModule } from './infrastructure/sqs/sqs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    DatabaseModule,
    SqsModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    // Authentication is enforced application-wide. Routes annotated with @Public()
    // (health checks) and deployments with AUTH_ENABLED=false bypass it.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
