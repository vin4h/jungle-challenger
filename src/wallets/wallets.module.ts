import { Module } from '@nestjs/common';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module';
import { WalletService } from './wallet.service';
import { WalletsController } from './wallets.controller';

@Module({
  imports: [PersistenceModule],
  controllers: [WalletsController],
  providers: [WalletService],
})
export class WalletsModule {}
