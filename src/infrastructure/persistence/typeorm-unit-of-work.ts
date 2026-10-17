import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Repositories, UnitOfWork } from '../../domain/unit-of-work';
import { TypeOrmOutboxRepository } from './typeorm-outbox.repository';
import { TypeOrmWagerTransactionRepository } from './typeorm-wager-transaction.repository';
import { TypeOrmWalletRepository } from './typeorm-wallet.repository';

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) =>
      work({
        wallets: new TypeOrmWalletRepository(manager),
        transactions: new TypeOrmWagerTransactionRepository(manager),
        outbox: new TypeOrmOutboxRepository(manager),
      }),
    );
  }
}
