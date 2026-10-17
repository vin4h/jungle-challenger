import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');

  await app.listen(port, '0.0.0.0');
  Logger.log(`HTTP listening on http://0.0.0.0:${port}`, 'Bootstrap');
}

await bootstrap();
