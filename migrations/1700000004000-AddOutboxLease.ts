import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxLease1700000004000 implements MigrationInterface {
  name = 'AddOutboxLease1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "outbox_messages" ADD COLUMN "claimed_until" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "outbox_messages" DROP COLUMN IF EXISTS "claimed_until"`,
    );
  }
}
