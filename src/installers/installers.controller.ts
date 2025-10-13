import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { InstallersService } from './installers.service';
import { CreateInstallerDto } from './dto/create-installer.dto';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../admin/admin.guard';

@Controller('installers')
export class InstallersController {
    constructor(private readonly installersService: InstallersService) { }

    // Apenas admins podem criar novos parceiros
    @Post()
    @UseGuards(AuthGuard('jwt'), AdminGuard)
    create(@Body() createInstallerDto: CreateInstallerDto) {
        return this.installersService.create(createInstallerDto);
    }

    // Qualquer utilizador autenticado pode ver a lista de parceiros
    @Get()
    @UseGuards(AuthGuard('jwt'))
    findAll() {
        return this.installersService.findAll();
    }
}