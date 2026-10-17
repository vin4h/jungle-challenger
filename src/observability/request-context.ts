import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly correlationId: string;
  readonly messageId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run<T>(context: RequestContext, work: () => T): T {
    return storage.run(context, work);
  },

  current(): RequestContext | undefined {
    return storage.getStore();
  },

  correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },

  messageId(): string | undefined {
    return storage.getStore()?.messageId;
  },
};
