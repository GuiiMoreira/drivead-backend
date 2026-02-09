// main.ts
import * as crypto from 'crypto';
(global as any).crypto = crypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
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

  // 1. VERSIONAMENTO DA API (Item 2.1 da Análise)
  // Define que todas as rotas da API começarão com /api/v1
  // Exemplo: POST /api/v1/auth/signup
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }], // Mantém health check na raiz se existir
  });

  // 2. CONFIGURAÇÃO DE VALIDAÇÃO (Item 6 da Análise)
  // Melhora a segurança rejeitando dados extras e transformando tipos
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,            // Remove propriedades que não estão no DTO
    forbidNonWhitelisted: true, // Retorna erro 400 se enviar propriedades extras
    transform: true,            // Converte tipos automaticamente (ex: "10" vira number 10)
  }));

  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`Application listening on port ${port} with prefix /api/v1`);
}
bootstrap();