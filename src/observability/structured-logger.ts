import { Injectable, type LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContextStore } from './request-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly minLevel: LogLevel;
  private readonly pretty: boolean;

  constructor(config: ConfigService) {
    this.minLevel = (config.get<string>('LOG_LEVEL') as LogLevel) ?? 'info';
    this.pretty = config.get<boolean>('LOG_PRETTY') ?? false;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  event(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    this.emit(level, message, fields);
  }

  private write(level: LogLevel, message: unknown, optionalParams: unknown[]): void {
    const params = [...optionalParams];
    const fields: Record<string, unknown> = {};

    if (params.length > 0 && typeof params[params.length - 1] === 'string') {
      fields.context = params.pop() as string;
    }
    for (const param of params) {
      if (param && typeof param === 'object') {
        Object.assign(fields, param as Record<string, unknown>);
      } else if (typeof param === 'string') {
        fields.detail = param;
      }
    }

    this.emit(level, String(message), fields);
  }

  private emit(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }

    const context = RequestContextStore.current();
    const record: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      msg: message,
      ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
      ...(context?.messageId ? { messageId: context.messageId } : {}),
      ...fields,
    };

    const line = this.pretty ? formatPretty(record) : JSON.stringify(record);
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }
}

function formatPretty(record: Record<string, unknown>): string {
  const { level, time, msg, ...rest } = record;
  const tail = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  return `${time} ${String(level).toUpperCase()} ${String(msg)}${tail}`;
}
