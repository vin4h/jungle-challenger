import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'jungle:is-public';

/**
 * Marks a route (or controller) as reachable without authentication.
 *
 * Used by the health endpoints, which must stay open per README section 2.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
