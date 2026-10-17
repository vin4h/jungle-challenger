import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('wallet_ledger_entries')
export class WalletLedgerEntryEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  walletId!: string;

  @Column('uuid')
  transactionId!: string;

  @Column('text')
  direction!: string;

  @Column('numeric', { precision: 18, scale: 2 })
  amount!: string;

  @Column('char', { length: 3 })
  currency!: string;

  @Column('numeric', { precision: 18, scale: 2 })
  balanceBefore!: string;

  @Column('numeric', { precision: 18, scale: 2 })
  balanceAfter!: string;

  @Column('timestamptz')
  createdAt!: Date;
}
