import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { baseDataSourceOptions } from './typeorm-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
        ...baseDataSourceOptions({
          DATABASE_URL: config.getOrThrow<string>('DATABASE_URL'),
          DB_LOGGING: config.get<boolean>('DB_LOGGING') ?? false,
        }),
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
