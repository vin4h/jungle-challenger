import type { EntityManager } from 'typeorm';
import { WalletAlreadyExistsError } from '../../domain/errors/wallet-already-exists.error';
import type { Wallet } from '../../domain/wallet/wallet';
import type { WalletLedgerEntry } from '../../domain/wallet/wallet-ledger-entry';
import type {
  FindWalletOptions,
  LedgerCursor,
  LedgerEntriesPage,
  ListLedgerEntriesOptions,
  WalletRepository,
} from '../../domain/wallet/wallet.repository';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity';
import { WalletEntity } from './entities/wallet.entity';
import { LedgerEntryMapper } from './mappers/wallet-ledger-entry.mapper';
import { WalletMapper } from './mappers/wallet.mapper';
import { isUniqueViolation } from './typeorm-errors';

export class TypeOrmWalletRepository implements WalletRepository {
  constructor(private readonly manager: EntityManager) {}

  async findById(id: string, options?: FindWalletOptions): Promise<Wallet | null> {
    const entity = await this.manager.findOne(WalletEntity, {
      where: { id },
      lock: options?.forUpdate ? { mode: 'pessimistic_write' } : undefined,
    });
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const entity = await this.manager.findOne(WalletEntity, { where: { playerId, currency } });
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async insert(wallet: Wallet): Promise<void> {
    try {
      await this.manager.insert(WalletEntity, WalletMapper.toRow(wallet));
    } catch (error) {
      if (isUniqueViolation(error, 'uq_wallets_player_currency')) {
        throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
      }
      throw error;
    }
  }

  async update(wallet: Wallet): Promise<void> {
    await this.manager.update(
      WalletEntity,
      { id: wallet.id },
      {
        balanceAmount: wallet.balance.toString(),
        version: wallet.version,
        updatedAt: wallet.updatedAt,
      },
    );
  }

  async insertLedgerEntries(entries: readonly WalletLedgerEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.manager.insert(WalletLedgerEntryEntity, entries.map(LedgerEntryMapper.toRow));
  }

  async listLedgerEntries(
    walletId: string,
    options: ListLedgerEntriesOptions,
  ): Promise<LedgerEntriesPage> {
    const query = this.manager
      .createQueryBuilder(WalletLedgerEntryEntity, 'entry')
      .where('entry.walletId = :walletId', { walletId })
      .orderBy('entry.createdAt', 'DESC')
      .addOrderBy('entry.id', 'DESC')
      .take(options.limit + 1);

    if (options.cursor) {
      query.andWhere(
        '(entry.createdAt < :createdAt OR (entry.createdAt = :createdAt AND entry.id < :id))',
        { createdAt: options.cursor.createdAt, id: options.cursor.id },
      );
    }

    const rows = await query.getMany();
    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page[page.length - 1];

    const nextCursor: LedgerCursor | undefined =
      hasMore && last ? { createdAt: last.createdAt, id: last.id } : undefined;

    return { entries: page.map(LedgerEntryMapper.toDomain), nextCursor };
  }
}
