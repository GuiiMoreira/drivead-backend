import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [PaymentsService],
  exports: [PaymentsService], // Exporta o serviço
})
export class PaymentsModule { }