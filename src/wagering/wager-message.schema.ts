import { z } from 'zod';

const moneySchema = z.object({
  amount: z.string().min(1),
  currency: z.string().min(1),
});

export const wagerTransactionMessageSchema = z.object({
  messageId: z.string().min(1),
  type: z.literal('WagerTransactionRequested'),
  occurredAt: z.string().min(1),
  data: z.object({
    providerId: z.string().min(1),
    externalTransactionId: z.string().min(1),
    idempotencyKey: z.string().min(1).optional(),
    playerId: z.string().min(1),
    walletId: z.string().min(1),
    roundId: z.string().min(1),
    gameId: z.string().min(1),
    kind: z.enum(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']),
    money: moneySchema,
    referenceExternalTransactionId: z.string().min(1).optional(),
  }),
});

export type WagerTransactionMessage = z.infer<typeof wagerTransactionMessageSchema>;
