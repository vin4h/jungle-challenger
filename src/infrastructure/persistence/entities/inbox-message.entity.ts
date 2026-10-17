import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('inbox_messages')
export class InboxMessageEntity {
  @PrimaryColumn('text')
  messageId!: string;

  @PrimaryColumn('text')
  consumerName!: string;

  @Column('text')
  payloadHash!: string;

  @Column('timestamptz')
  receivedAt!: Date;

  @Column('timestamptz', { nullable: true })
  processedAt!: Date | null;
}
