import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { baseDataSourceOptions } from './typeorm-options';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://jungle:jungle@localhost:5432/jungle';

const dataSource = new DataSource(
  baseDataSourceOptions({
    DATABASE_URL: databaseUrl,
    DB_LOGGING: process.env.DB_LOGGING === 'true',
  }),
);

export default dataSource;
