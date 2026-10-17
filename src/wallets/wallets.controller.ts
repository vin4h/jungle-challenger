import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './ledger-cursor';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import {
  toLedgerEntryResponse,
  toReconciliationResponse,
  toWalletResponse,
  type LedgerResponse,
  type ReconciliationResponse,
  type WalletResponse,
} from './wallet.presenter';
import { WalletService } from './wallet.service';

const DEFAULT_LEDGER_LIMIT = 50;

@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  async create(@Body() body: CreateWalletDto): Promise<WalletResponse> {
    const wallet = await this.walletService.createWallet(body);
    return toWalletResponse(wallet);
  }

  @Get(':walletId')
  async get(@Param('walletId') walletId: string): Promise<WalletResponse> {
    const wallet = await this.walletService.getWallet(walletId);
    return toWalletResponse(wallet);
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId') walletId: string,
    @Query() query: LedgerQueryDto,
  ): Promise<LedgerResponse> {
    const page = await this.walletService.getLedger(walletId, {
      limit: query.limit ?? DEFAULT_LEDGER_LIMIT,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
    });

    return {
      entries: page.entries.map(toLedgerEntryResponse),
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
    };
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcile(@Param('walletId') walletId: string): Promise<ReconciliationResponse> {
    const result = await this.walletService.reconcile(walletId);
    return toReconciliationResponse(result);
  }
}
