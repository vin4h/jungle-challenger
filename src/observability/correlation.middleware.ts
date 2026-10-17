import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { RequestContextStore } from './request-context';

const HEADER = 'x-correlation-id';
const MAX_LENGTH = 128;

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const header = request.headers[HEADER];
    const value = typeof header === 'string' ? header.trim() : '';
    const correlationId = value.length > 0 ? value.slice(0, MAX_LENGTH) : uuidv7();

    response.setHeader(HEADER, correlationId);
    RequestContextStore.run({ correlationId }, () => next());
  }
}
