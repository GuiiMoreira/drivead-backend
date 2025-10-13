import { Module } from '@nestjs/common';
import { InstallersService } from './installers.service';
import { InstallersController } from './installers.controller';

@Module({
  providers: [InstallersService],
  controllers: [InstallersController]
})
export class InstallersModule {}
