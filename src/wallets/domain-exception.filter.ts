import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../domain/errors/domain-error';

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  INVALID_MONEY: HttpStatus.BAD_REQUEST,
  CURRENCY_MISMATCH: HttpStatus.BAD_REQUEST,
  INVALID_LEDGER_ENTRY: HttpStatus.BAD_REQUEST,
  INVALID_WALLET_STATE: HttpStatus.BAD_REQUEST,
  INVALID_WAGER_TRANSACTION: HttpStatus.BAD_REQUEST,
  INVALID_TRANSACTION_STATE: HttpStatus.BAD_REQUEST,
  WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
  WAGER_TRANSACTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  WALLET_ALREADY_EXISTS: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  DUPLICATE_WAGER_TRANSACTION: HttpStatus.CONFLICT,
  INSUFFICIENT_FUNDS: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(status).json({
      statusCode: status,
      code: exception.code,
      message: exception.message,
    });
  }
}
