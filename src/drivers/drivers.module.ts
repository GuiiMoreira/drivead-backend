import { Module } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { StorageModule } from '../storage/storage.module'; // 1. Importe o StorageModule

@Module({
  imports: [StorageModule], // 2. Adicione o StorageModule aqui
  controllers: [DriversController],
  providers: [DriversService],
})
export class DriversModule { }