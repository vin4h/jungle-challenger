export interface EventToPublish {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EventPublisher {
  publish(event: EventToPublish): Promise<void>;
}
