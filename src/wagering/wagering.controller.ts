import { Body, Controller, Get, Headers, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WagerTransactionStatus } from '../domain/wager-transaction/enums';
import { CreateWagerTransactionDto } from './dto/create-wager-transaction.dto';
import {
  ProcessWagerTransactionUseCase,
  type WageringOutcome,
} from './process-wager-transaction.use-case';
import { toWageringResponse, type WageringResponse } from './wagering.presenter';
import { WageringService } from './wagering.service';

function statusFor(outcome: WageringOutcome): number {
  if (outcome.idempotentReplay) {
    return HttpStatus.OK;
  }
  switch (outcome.transaction.status) {
    case WagerTransactionStatus.Processed:
      return HttpStatus.CREATED;
    case WagerTransactionStatus.PendingReference:
      return HttpStatus.ACCEPTED;
    case WagerTransactionStatus.Rejected:
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case WagerTransactionStatus.Failed:
      return HttpStatus.SERVICE_UNAVAILABLE;
    default:
      return HttpStatus.OK;
  }
}

@Controller()
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly wageringService: WageringService,
  ) {}

  @Post('wagering/transactions')
  async create(
    @Body() body: CreateWagerTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WageringResponse> {
    const outcome = await this.processWagerTransaction.execute({
      ...body,
      idempotencyKey: idempotencyKey ?? `${body.providerId}:${body.externalTransactionId}`,
      correlationId,
    });
    response.status(statusFor(outcome));
    return toWageringResponse(outcome.transaction, outcome.idempotentReplay);
  }

  @Get('wagering/transactions/:transactionId')
  async getById(@Param('transactionId') transactionId: string): Promise<WageringResponse> {
    const transaction = await this.wageringService.getById(transactionId);
    return toWageringResponse(transaction, false);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async getByProvider(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ): Promise<WageringResponse> {
    const transaction = await this.wageringService.getByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
    return toWageringResponse(transaction, false);
  }
}
