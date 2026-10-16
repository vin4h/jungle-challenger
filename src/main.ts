import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Input is untrusted: strip unknown fields and reject unexpected ones.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Graceful shutdown: lets the consumer finish in-flight messages and return
  // visibility before exiting (README section 10). Required by the smoke test too.
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');

  await app.listen(port, '0.0.0.0');
  Logger.log(`HTTP listening on http://0.0.0.0:${port}`, 'Bootstrap');
}

await bootstrap();
