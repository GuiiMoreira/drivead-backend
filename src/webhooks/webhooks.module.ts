import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [WebhooksController],
})
export class WebhooksModule { }