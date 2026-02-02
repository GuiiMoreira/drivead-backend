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
import { PaymentsModule } from './payments/payments.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { UsersModule } from './users/users.module';
import { AdvertisersModule } from './advertisers/advertisers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core'; 

@Module({
  imports: [
    // 1. Configuração do Rate Limiter (Segurança)
    // Define um limite global de 20 requisições a cada 60 segundos (1 minuto) por IP
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 20,
    }]),

    // 2. Configurações Gerais
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDISHOST', 'localhost'),
          port: Number(configService.get('REDISPORT', 6379)),
          password: configService.get('REDISPASSWORD'),
          username: configService.get('REDISUSER'),
        },
      }),
      inject: [ConfigService],
    }),

    // 3. Módulos da Aplicação
    AuthModule,
    DriversModule,
    AdminModule,
    CampaignsModule,
    InstallersModule,
    PositionsModule,
    JobsModule,
    StorageModule,
    PaymentsModule,
    WebhooksModule,
    UsersModule,
    AdvertisersModule,
    NotificationsModule,
  ],
  controllers: [],
  providers: [
    // 4. Aplicar o Guard de Rate Limiting globalmente
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }