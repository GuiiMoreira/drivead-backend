import { Module } from '@nestjs/common';
import { AdvertisersService } from './advertisers.service';
import { AdvertisersController } from './advertisers.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
@Module({
  imports: [
    PrismaModule,
    StorageModule
  ],
  controllers: [AdvertisersController],
  providers: [AdvertisersService],
})
export class AdvertisersModule {}