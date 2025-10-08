import { Controller, Get, Post, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';

@UseGuards(AuthGuard('jwt'), AdminGuard) // Aplica ambas as guardas a todos os endpoints deste controlador
@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Get('drivers/pending')
    async getPendingDrivers() {
        const drivers = await this.adminService.listPendingDrivers();
        return {
            success: true,
            data: drivers,
        };
    }

    @Post('drivers/:id/approve')
    async approveDriver(@Param('id', ParseUUIDPipe) id: string) {
        const driver = await this.adminService.approveDriver(id);
        return {
            success: true,
            message: `Motorista ${driver.id} aprovado com sucesso.`,
            data: driver,
        };
    }
}