import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInbox1700000003000 implements MigrationInterface {
  name = 'CreateInbox1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inbox_messages" (
        "message_id" text NOT NULL,
        "consumer_name" text NOT NULL,
        "payload_hash" text NOT NULL,
        "received_at" timestamptz NOT NULL,
        "processed_at" timestamptz,
        CONSTRAINT "pk_inbox_messages" PRIMARY KEY ("consumer_name", "message_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_inbox_messages_pending"
      ON "inbox_messages" ("consumer_name")
      WHERE "processed_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_inbox_messages_pending"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inbox_messages"`);
  }
}
