import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('wager_transactions')
export class WagerTransactionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  kind!: string;

  @Column('text')
  status!: string;

  @Column('text', { nullable: true })
  providerId!: string | null;

  @Column('text', { nullable: true })
  externalTransactionId!: string | null;

  @Column('text')
  idempotencyKey!: string;

  @Column('text')
  payloadHash!: string;

  @Column('uuid')
  walletId!: string;

  @Column('uuid')
  playerId!: string;

  @Column('text', { nullable: true })
  roundId!: string | null;

  @Column('text', { nullable: true })
  gameId!: string | null;

  @Column('numeric', { precision: 18, scale: 2 })
  amount!: string;

  @Column('char', { length: 3 })
  currency!: string;

  @Column('text', { nullable: true })
  referenceExternalTransactionId!: string | null;

  @Column('uuid', { nullable: true })
  referenceTransactionId!: string | null;

  @Column('text', { nullable: true })
  failureCode!: string | null;

  @Column('timestamptz', { nullable: true })
  processedAt!: Date | null;

  @Column('timestamptz')
  createdAt!: Date;
}
