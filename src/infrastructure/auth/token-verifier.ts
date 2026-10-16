import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * Verifies bearer tokens issued by the external Identity Provider (Keycloak).
 *
 * The JWKS is fetched lazily and cached by `jose`; key rotation is handled
 * transparently. No user store is kept locally — identity is delegated to the IdP,
 * as required by README section 2.
 */
@Injectable()
export class TokenVerifier {
  private readonly logger = new Logger(TokenVerifier.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(config: ConfigService) {
    this.issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER');
    this.audience = config.getOrThrow<string>('KEYCLOAK_AUDIENCE');
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/protocol/openid-connect/certs`));
  }

  async verify(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience,
    });
    this.logger.debug(`Token verified for subject=${payload.sub ?? 'unknown'}`);
    return payload;
  }
}
