import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { TokenVerifier } from './token-verifier';

@Module({
  providers: [TokenVerifier, AuthGuard],
  exports: [TokenVerifier, AuthGuard],
})
export class AuthModule {}
