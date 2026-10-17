import { QueryFailedError } from 'typeorm';

interface PostgresDriverError {
  readonly code?: string;
  readonly constraint?: string;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = (error as QueryFailedError & { driverError?: PostgresDriverError }).driverError;
  if (driverError?.code !== '23505') {
    return false;
  }
  return constraint === undefined || driverError.constraint === constraint;
}
