import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { AuthGuard } from './infrastructure/auth/auth.guard';
import { AuthModule } from './infrastructure/auth/auth.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { SqsModule } from './infrastructure/sqs/sqs.module';
import { DomainExceptionFilter } from './wallets/domain-exception.filter';
import { WalletsModule } from './wallets/wallets.module';
import { WageringModule } from './wagering/wagering.module';
import { MessagingModule } from './messaging/messaging.module';

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
    WalletsModule,
    WageringModule,
    MessagingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
