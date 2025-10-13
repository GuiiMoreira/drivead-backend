import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PositionsService } from './positions.service';
import { CreatePositionsDto } from './dto/create-position.dto';
import { DriverGuard } from '../core/guards/driver.guard';
import { User } from '@prisma/client';

@Controller('positions')
export class PositionsController {
    constructor(private readonly positionsService: PositionsService) { }

    @Post()
    @UseGuards(AuthGuard('jwt'), DriverGuard)
    async createPositions(@Req() req, @Body() createPositionsDto: CreatePositionsDto) {
        const user = req.user as User;
        const result = await this.positionsService.createPositions(user, createPositionsDto.positions);

        return {
            success: true,
            message: `${result!.count} posições recebidas com sucesso.`,
        };
    }
}