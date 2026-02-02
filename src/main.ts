// main.ts
import * as crypto from 'crypto';
(global as any).crypto = crypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // NECESSÁRIO PARA RATE LIMITING EM NUVEM (Railway, AWS, etc):
  // Faz o Express confiar no proxy reverso para identificar o IP real do cliente.
  // Sem isso, o Rate Limiter bloquearia o IP do Load Balancer (bloqueando todos os usuários).
  const expressApp = app.getHttpAdapter().getInstance();
  if (expressApp && typeof expressApp.set === 'function') {
      expressApp.set('trust proxy', 1);
  }

  app.useGlobalPipes(new ValidationPipe());
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`Application listening on port ${port}`);
}
bootstrap();