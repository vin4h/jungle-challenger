import { Module } from '@nestjs/common';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module';
import { SqsEventPublisher } from '../infrastructure/sqs/sqs-event-publisher';
import { EVENT_PUBLISHER } from './messaging.tokens';
import { OutboxPublisher } from './outbox-publisher.service';

@Module({
  imports: [PersistenceModule],
  providers: [{ provide: EVENT_PUBLISHER, useClass: SqsEventPublisher }, OutboxPublisher],
  exports: [EVENT_PUBLISHER, OutboxPublisher],
})
export class MessagingModule {}
