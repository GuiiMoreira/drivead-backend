import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsService } from './jobs.service';
import { MetricsProcessor } from './metrics.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'metrics-queue',
    }),
  ],
  providers: [JobsService, MetricsProcessor],
})
export class JobsModule { }