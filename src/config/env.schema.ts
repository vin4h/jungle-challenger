import { z } from 'zod';

const envBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_LOGGING: envBoolean(false),

  AWS_REGION: z.string().min(1).default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1).default('test'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).default('test'),
  SQS_ENDPOINT: z.string().url().optional(),
  SQS_WAGER_QUEUE_URL: z.string().url(),
  SQS_WAGER_DLQ_URL: z.string().url(),

  AUTH_ENABLED: envBoolean(true),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_AUDIENCE: z.string().min(1).default('account'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
