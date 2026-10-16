import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline migration.
 *
 * Enables the extensions the schema depends on and proves the migration pipeline
 * is versioned and reversible (README section 4). Domain tables arrive in
 * subsequent migrations.
 */
export class InitExtensions1700000000000 implements MigrationInterface {
  name = 'InitExtensions1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS "citext"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "pgcrypto"`);
  }
}
