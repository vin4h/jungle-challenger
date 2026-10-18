import { expect } from 'bun:test';
import type { DataSource } from 'typeorm';

export interface LedgerSummary {
  readonly balance: string;
  readonly entries: number;
}

export async function ledgerSummary(
  dataSource: DataSource,
  walletId: string,
): Promise<LedgerSummary> {
  const rows = await dataSource.query<Array<{ balance: string; entries: number }>>(
    `SELECT COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END), 0)::numeric(18,2)::text AS "balance",
            COUNT(*)::int AS "entries"
       FROM "wallet_ledger_entries"
      WHERE "wallet_id" = $1`,
    [walletId],
  );
  const row = rows[0];
  return { balance: row?.balance ?? '0.00', entries: row?.entries ?? 0 };
}

/**
 * Invariante final dos testes de integração: o saldo materializado na wallet precisa ser
 * exatamente o saldo reconstruído pelo ledger (CREDIT - DEBIT).
 *
 * Não use em testes que corrompem o saldo de propósito (ex.: reconciliação com divergência).
 */
export async function assertWalletMatchesLedger(
  dataSource: DataSource,
  walletId: string,
): Promise<void> {
  const wallets = await dataSource.query<Array<{ balance_amount: string }>>(
    'SELECT "balance_amount" FROM "wallets" WHERE "id" = $1',
    [walletId],
  );
  const wallet = wallets[0];
  expect(wallet).toBeDefined();

  const summary = await ledgerSummary(dataSource, walletId);
  expect(wallet?.balance_amount).toBe(summary.balance);
}
