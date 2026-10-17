import { BadRequestException } from '@nestjs/common';
import type { LedgerCursor } from '../domain/wallet/wallet.repository';

export function encodeCursor(cursor: LedgerCursor): string {
  const payload = JSON.stringify({ t: cursor.createdAt.toISOString(), i: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): LedgerCursor {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') {
      throw new Error('malformed cursor');
    }
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('malformed timestamp');
    }
    return { createdAt, id: parsed.i };
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}
