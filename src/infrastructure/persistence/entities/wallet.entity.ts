import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('wallets')
export class WalletEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  playerId!: string;

  @Column('char', { length: 3 })
  currency!: string;

  @Column('numeric', { precision: 18, scale: 2 })
  balanceAmount!: string;

  @Column('int')
  version!: number;

  @Column('timestamptz')
  createdAt!: Date;

  @Column('timestamptz')
  updatedAt!: Date;
}
