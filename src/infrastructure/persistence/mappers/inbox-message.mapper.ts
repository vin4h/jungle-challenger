import { InboxMessage } from '../../../domain/messaging/inbox-message';
import { InboxMessageEntity } from '../entities/inbox-message.entity';

export const InboxMessageMapper = {
  toDomain(entity: InboxMessageEntity): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: entity.messageId,
      consumerName: entity.consumerName,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt ?? undefined,
    });
  },

  toRow(message: InboxMessage): InboxMessageEntity {
    return Object.assign(new InboxMessageEntity(), {
      messageId: message.messageId,
      consumerName: message.consumerName,
      payloadHash: message.payloadHash,
      receivedAt: message.receivedAt,
      processedAt: message.processedAt ?? null,
    });
  },
};
