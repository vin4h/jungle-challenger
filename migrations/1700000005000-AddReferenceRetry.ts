import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReferenceRetry1700000005000 implements MigrationInterface {
  name = 'AddReferenceRetry1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wager_transactions"
        ADD COLUMN "reference_attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN "reference_next_attempt_at" timestamptz
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_wager_transactions_pending_reference"
      ON "wager_transactions" ("reference_next_attempt_at")
      WHERE "status" = 'PENDING_REFERENCE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_wager_transactions_pending_reference"`);
    await queryRunner.query(`
      ALTER TABLE "wager_transactions"
        DROP COLUMN IF EXISTS "reference_attempts",
        DROP COLUMN IF EXISTS "reference_next_attempt_at"
    `);
  }
}
