import type { IntegrationEvent } from './integration-event';

export interface OutboxMessageState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt?: Date;
  readonly claimedUntil?: Date;
  readonly publishedAt?: Date;
  readonly createdAt: Date;
}

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt: Date | undefined,
    private _claimedUntil: Date | undefined,
    private _publishedAt: Date | undefined,
    public readonly createdAt: Date,
  ) {}

  static enqueue(event: IntegrationEvent<unknown>, options: { readonly createdAt: Date }): OutboxMessage {
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      event.toJSON() as unknown as Record<string, unknown>,
      event.occurredAt,
      0,
      undefined,
      undefined,
      undefined,
      options.createdAt,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.claimedUntil,
      state.publishedAt,
      state.createdAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get claimedUntil(): Date | undefined {
    return this._claimedUntil;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isClaimable(now: Date): boolean {
    return (
      this.isPending() &&
      (this._nextAttemptAt === undefined || this._nextAttemptAt <= now) &&
      (this._claimedUntil === undefined || this._claimedUntil <= now)
    );
  }

  claim(until: Date): void {
    this._claimedUntil = until;
  }

  markPublished(at: Date): void {
    this._publishedAt = at;
    this._claimedUntil = undefined;
  }

  scheduleRetry(now: Date): void {
    this._attempts += 1;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (this._attempts - 1), MAX_BACKOFF_MS);
    this._nextAttemptAt = new Date(now.getTime() + delay);
    this._claimedUntil = undefined;
  }
}
