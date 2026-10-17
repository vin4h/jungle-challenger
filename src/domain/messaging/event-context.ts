export interface EventContext {
  readonly eventId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}
