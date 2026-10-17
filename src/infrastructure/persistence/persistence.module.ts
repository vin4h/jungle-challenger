import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxMessageEntity } from './entities/outbox-message.entity';
import { WagerTransactionEntity } from './entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity';
import { WalletEntity } from './entities/wallet.entity';
import { UNIT_OF_WORK } from './persistence.tokens';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WalletEntity,
      WalletLedgerEntryEntity,
      WagerTransactionEntity,
      OutboxMessageEntity,
    ]),
  ],
  providers: [{ provide: UNIT_OF_WORK, useClass: TypeOrmUnitOfWork }],
  exports: [UNIT_OF_WORK],
})
export class PersistenceModule {}
