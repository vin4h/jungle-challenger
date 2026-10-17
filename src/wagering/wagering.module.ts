import { Module } from '@nestjs/common';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module';
import { PendingReferenceWorker } from './pending-reference-worker.service';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case';
import { SqsWagerConsumer } from './sqs-wager-consumer.service';
import { WageringController } from './wagering.controller';
import { WageringService } from './wagering.service';

@Module({
  imports: [PersistenceModule],
  controllers: [WageringController],
  providers: [
    ProcessWagerTransactionUseCase,
    WageringService,
    SqsWagerConsumer,
    PendingReferenceWorker,
  ],
})
export class WageringModule {}
