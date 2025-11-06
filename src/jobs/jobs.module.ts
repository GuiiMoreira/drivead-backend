import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsService } from './jobs.service';
import { MetricsProcessor } from './metrics.processor';
import { AntifraudProcessor } from './antifraud.processor';


@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'metrics-queue' },
      { name: 'antifraud-queue' }, // <-- 2. Adicione a nova fila
    ),
  ],
  providers: [
    JobsService,
    MetricsProcessor,
    AntifraudProcessor, // <-- 3. Adicione o novo processor
  ],
})
export class JobsModule { }