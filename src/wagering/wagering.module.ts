import { Module } from '@nestjs/common';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case';
import { WageringController } from './wagering.controller';
import { WageringService } from './wagering.service';

@Module({
  imports: [PersistenceModule],
  controllers: [WageringController],
  providers: [ProcessWagerTransactionUseCase, WageringService],
})
export class WageringModule {}
