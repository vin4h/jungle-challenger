import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

export interface DatabaseEnv {
  readonly DATABASE_URL: string;
  readonly DB_LOGGING?: boolean;
}

/**
 * Shared DataSource options used by both the Nest runtime module and the
 * TypeORM CLI (`data-source.ts`).
 *
 * `synchronize` is always false: the schema is owned by versioned migrations.
 */
export function baseDataSourceOptions(env: DatabaseEnv, cwd: string = process.cwd()): DataSourceOptions {
  return {
    type: 'postgres',
    url: env.DATABASE_URL,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    logging: env.DB_LOGGING ? ['error', 'warn', 'schema'] : ['error', 'warn'],
    entities: [join(cwd, 'src/**/*.entity.{ts,js}')],
    migrations: [join(cwd, 'migrations/*.{ts,js}')],
  };
}
