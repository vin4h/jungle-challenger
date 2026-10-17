import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TokenVerifier } from './token-verifier';

export interface AuthenticatedActor {
  readonly subject: string;
  readonly claims: Record<string, unknown>;
}

type AuthenticatedRequest = Request & { actor?: AuthenticatedActor };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly verifier: TokenVerifier,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    if (!this.config.get<boolean>('AUTH_ENABLED')) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const claims = await this.verifier.verify(token);
      request.actor = {
        subject: String(claims.sub ?? ''),
        claims: claims as Record<string, unknown>,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired bearer token');
    }
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return undefined;
  }
  return value;
}
