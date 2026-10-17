import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('outbox_messages')
export class OutboxMessageEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  aggregateId!: string;

  @Column('text')
  eventType!: string;

  @Column('jsonb')
  payload!: Record<string, unknown>;

  @Column('timestamptz')
  occurredAt!: Date;

  @Column('int')
  attempts!: number;

  @Column('timestamptz', { nullable: true })
  nextAttemptAt!: Date | null;

  @Column('timestamptz', { nullable: true })
  claimedUntil!: Date | null;

  @Column('timestamptz', { nullable: true })
  publishedAt!: Date | null;

  @Column('timestamptz')
  createdAt!: Date;
}
