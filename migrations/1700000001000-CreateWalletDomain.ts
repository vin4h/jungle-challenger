import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWalletDomain1700000001000 implements MigrationInterface {
  name = 'CreateWalletDomain1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "id" uuid PRIMARY KEY,
        "player_id" uuid NOT NULL,
        "currency" char(3) NOT NULL,
        "balance_amount" numeric(18,2) NOT NULL,
        "version" integer NOT NULL,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "uq_wallets_player_currency" UNIQUE ("player_id", "currency"),
        CONSTRAINT "ck_wallets_balance_non_negative" CHECK ("balance_amount" >= 0),
        CONSTRAINT "ck_wallets_version_positive" CHECK ("version" >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "wager_transactions" (
        "id" uuid PRIMARY KEY,
        "kind" text NOT NULL,
        "status" text NOT NULL,
        "provider_id" text,
        "external_transaction_id" text,
        "idempotency_key" text NOT NULL,
        "payload_hash" text NOT NULL,
        "wallet_id" uuid NOT NULL,
        "player_id" uuid NOT NULL,
        "round_id" text,
        "game_id" text,
        "amount" numeric(18,2) NOT NULL,
        "currency" char(3) NOT NULL,
        "reference_external_transaction_id" text,
        "reference_transaction_id" uuid,
        "failure_code" text,
        "processed_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "fk_wager_transactions_wallet" FOREIGN KEY ("wallet_id") REFERENCES "wallets" ("id"),
        CONSTRAINT "fk_wager_transactions_reference" FOREIGN KEY ("reference_transaction_id") REFERENCES "wager_transactions" ("id"),
        CONSTRAINT "ck_wager_transactions_kind" CHECK ("kind" IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        CONSTRAINT "ck_wager_transactions_status" CHECK ("status" IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        CONSTRAINT "ck_wager_transactions_amount_non_negative" CHECK ("amount" >= 0),
        CONSTRAINT "ck_wager_transactions_external_fields" CHECK (
          "kind" = 'OPENING' OR (
            "provider_id" IS NOT NULL AND
            "external_transaction_id" IS NOT NULL AND
            "round_id" IS NOT NULL AND
            "game_id" IS NOT NULL
          )
        ),
        CONSTRAINT "uq_wager_transactions_provider_external" UNIQUE ("provider_id", "external_transaction_id"),
        CONSTRAINT "uq_wager_transactions_idempotency_key" UNIQUE ("idempotency_key")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_wager_transactions_status" ON "wager_transactions" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "wallet_ledger_entries" (
        "id" uuid PRIMARY KEY,
        "wallet_id" uuid NOT NULL,
        "transaction_id" uuid NOT NULL,
        "direction" text NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "currency" char(3) NOT NULL,
        "balance_before" numeric(18,2) NOT NULL,
        "balance_after" numeric(18,2) NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "fk_wallet_ledger_entries_wallet" FOREIGN KEY ("wallet_id") REFERENCES "wallets" ("id"),
        CONSTRAINT "fk_wallet_ledger_entries_transaction" FOREIGN KEY ("transaction_id") REFERENCES "wager_transactions" ("id"),
        CONSTRAINT "uq_wallet_ledger_entries_transaction_wallet" UNIQUE ("transaction_id", "wallet_id"),
        CONSTRAINT "ck_wallet_ledger_entries_direction" CHECK ("direction" IN ('DEBIT','CREDIT')),
        CONSTRAINT "ck_wallet_ledger_entries_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "ck_wallet_ledger_entries_balance_non_negative" CHECK ("balance_before" >= 0 AND "balance_after" >= 0),
        CONSTRAINT "ck_wallet_ledger_entries_balanced" CHECK (
          ("direction" = 'CREDIT' AND "balance_before" + "amount" = "balance_after")
          OR ("direction" = 'DEBIT' AND "balance_before" - "amount" = "balance_after")
        )
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_wallet_ledger_entries_wallet_created" ON "wallet_ledger_entries" ("wallet_id", "created_at" DESC, "id" DESC)`,
    );

    await queryRunner.query(`
      CREATE FUNCTION "wallet_ledger_entries_immutable"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entries is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_wallet_ledger_entries_immutable"
      BEFORE UPDATE OR DELETE ON "wallet_ledger_entries"
      FOR EACH ROW EXECUTE FUNCTION "wallet_ledger_entries_immutable"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_wallet_ledger_entries_immutable" ON "wallet_ledger_entries"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "wallet_ledger_entries_immutable"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_ledger_entries"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_wager_transactions_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wager_transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wallets"`);
  }
}
