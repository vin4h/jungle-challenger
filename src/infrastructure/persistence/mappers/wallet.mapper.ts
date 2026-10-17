import { Money } from '../../../domain/money/money';
import { Wallet } from '../../../domain/wallet/wallet';
import { WalletEntity } from '../entities/wallet.entity';

export const WalletMapper = {
  toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.rehydrate({ amount: entity.balanceAmount, currency: entity.currency }),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  },

  toRow(wallet: Wallet): WalletEntity {
    return Object.assign(new WalletEntity(), {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balanceAmount: wallet.balance.toString(),
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    });
  },
};
