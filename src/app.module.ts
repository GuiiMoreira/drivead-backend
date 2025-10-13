import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { DriversModule } from './drivers/drivers.module';
import { AdminModule } from './admin/admin.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { InstallersModule } from './installers/installers.module';
import { PositionsModule } from './positions/positions.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { JobsModule } from './jobs/jobs.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Torna as variáveis de ambiente disponíveis globalmente
    }),
    AuthModule,
    PrismaModule,
    DriversModule,
    AdminModule,
    CampaignsModule,
    InstallersModule,
    PositionsModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(), // Módulo de agendamento
    BullModule.forRootAsync({ // Módulo do BullMQ
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          // Adicione password se o seu Redis tiver uma
        },
      }),
      inject: [ConfigService],
    }), JobsModule, StorageModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }