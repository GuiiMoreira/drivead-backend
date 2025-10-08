import { Controller, Post, Body, UseGuards, Req, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { User } from '@prisma/client';

@Controller('drivers')
export class DriversController {
    constructor(private readonly driversService: DriversService) { }

    /**
     * Endpoint para um utilizador autenticado criar o seu perfil de motorista e
     * registar o seu primeiro veículo.
     */
    @UseGuards(AuthGuard('jwt'))
    @Post()
    async createDriverProfile(@Req() req, @Body() createDriverDto: CreateDriverDto) {
        // O objeto `user` é extraído do token JWT pela nossa JwtStrategy
        const user = req.user as User;

        const result = await this.driversService.createDriverProfile(user, createDriverDto);
        return {
            success: true,
            data: result,
        };
    }

    @Post('documents')
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(FileFieldsInterceptor([
        { name: 'cnhFront', maxCount: 1 },
        { name: 'cnhBack', maxCount: 1 },
        { name: 'crlv', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
    ]))
    async uploadKycDocuments(
        @Req() req,
        @UploadedFiles() files: { cnhFront?: Express.Multer.File[], cnhBack?: Express.Multer.File[], crlv?: Express.Multer.File[], selfie?: Express.Multer.File[] }
    ) {
        const user = req.user as User;
        await this.driversService.saveKycDocuments(user, files);

        return {
            success: true,
            message: 'Documentos enviados para aprovação com sucesso.',
        };
    }
}