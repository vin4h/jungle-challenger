import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletLedgerEntryEntity } from '../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntity } from '../infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from '../infrastructure/persistence/entities/wager-transaction.entity';
import { TypeOrmUnitOfWork } from '../infrastructure/persistence/typeorm-unit-of-work';
import { WalletService } from './wallet.service';
import { WalletsController } from './wallets.controller';
import { UNIT_OF_WORK } from './wallets.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([WalletEntity, WalletLedgerEntryEntity, WagerTransactionEntity]),
  ],
  controllers: [WalletsController],
  providers: [WalletService, { provide: UNIT_OF_WORK, useClass: TypeOrmUnitOfWork }],
})
export class WalletsModule {}
