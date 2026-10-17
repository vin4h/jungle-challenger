import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutbox1700000002000 implements MigrationInterface {
  name = 'CreateOutbox1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_messages" (
        "id" uuid PRIMARY KEY,
        "aggregate_id" uuid NOT NULL,
        "event_type" text NOT NULL,
        "payload" jsonb NOT NULL,
        "occurred_at" timestamptz NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz,
        "published_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "ck_outbox_messages_attempts_non_negative" CHECK ("attempts" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_outbox_messages_pending_due"
      ON "outbox_messages" ("next_attempt_at")
      WHERE "published_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "wager_transactions"
        ADD COLUMN "result_balance_amount" numeric(18,2),
        ADD COLUMN "result_balance_currency" char(3)
    `);

    await queryRunner.query(`
      ALTER TABLE "wager_transactions"
        ADD CONSTRAINT "ck_wager_transactions_result_balance_complete" CHECK (
          ("result_balance_amount" IS NULL AND "result_balance_currency" IS NULL)
          OR ("result_balance_amount" IS NOT NULL AND "result_balance_currency" IS NOT NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wager_transactions" DROP CONSTRAINT IF EXISTS "ck_wager_transactions_result_balance_complete"`,
    );
    await queryRunner.query(`
      ALTER TABLE "wager_transactions"
        DROP COLUMN IF EXISTS "result_balance_amount",
        DROP COLUMN IF EXISTS "result_balance_currency"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_outbox_messages_pending_due"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_messages"`);
  }
}
