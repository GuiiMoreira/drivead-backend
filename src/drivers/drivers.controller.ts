import {
    Controller, Post, Body, UseGuards, Req, Get, Param, ParseUUIDPipe,
    UseInterceptors, UploadedFiles, UploadedFile, ParseFilePipe, MaxFileSizeValidator, FileTypeValidator
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SubmitProofDto } from './dto/submit-proof.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { DriverGuard } from '../core/guards/driver.guard';
import { AuthGuard } from '@nestjs/passport';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { User } from '@prisma/client';
import { ScheduleInstallDto } from './dto/schedule-install.dto';
import { WithdrawRequestDto } from './dto/withdraw-request.dto';

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

    @Get('me/campaigns')
    @UseGuards(AuthGuard('jwt'), DriverGuard)
    async getEligibleCampaigns(@Req() req) {
        const user = req.user as User;
        const campaigns = await this.driversService.listEligibleCampaigns(user);
        return {
            success: true,
            data: campaigns,
        };
    }

    @Post('me/campaigns/:id/apply')
    @UseGuards(AuthGuard('jwt'), DriverGuard)
    async applyForCampaign(
        @Req() req,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        const user = req.user as User;
        const assignment = await this.driversService.applyForCampaign(user, id);
        return {
            success: true,
            message: 'Candidatura para a campanha enviada com sucesso.',
            data: assignment,
        };
    }

    @Get('me/assignment')
    @UseGuards(AuthGuard('jwt'), DriverGuard)
    async getCurrentAssignment(@Req() req) {
        const assignment = await this.driversService.getCurrentAssignment(req.user as User);
        return { success: true, data: assignment };
    }

    @Post('me/assignment/schedule')
    @UseGuards(AuthGuard('jwt'), DriverGuard)
    async scheduleInstallation(
        @Req() req,
        @Body() scheduleDto: ScheduleInstallDto,
    ) {
        const updatedAssignment = await this.driversService.scheduleInstallation(
            req.user as User,
            scheduleDto,
        );
        return {
            success: true,
            message: 'Instalação agendada com sucesso.',
            data: updatedAssignment,
        };
    }

    @Post('me/assignment/confirm-installation')
    @UseGuards(AuthGuard('jwt'), DriverGuard)
    @UseInterceptors(FileFieldsInterceptor([
        { name: 'photoBefore', maxCount: 1 },
        { name: 'photoAfter', maxCount: 1 },
    ]))
    async confirmInstallation(
        @Req() req,
        @UploadedFiles() files: { photoBefore?: Express.Multer.File[], photoAfter?: Express.Multer.File[] }
    ) {
        const user = req.user as User;
        const assignment = await this.driversService.confirmInstallation(user, files);

        return {
            success: true,
            message: 'Instalação confirmada com sucesso! A sua campanha está oficialmente ativa.',
            data: assignment,
        };
    }

    @Get('me/wallet')
    @UseGuards(AuthGuard('jwt'), DriverGuard)
    async getMyWallet(@Req() req) {
        const wallet = await this.driversService.getMyWallet(req.user as User);
        return {
            success: true,
            data: wallet,
        };
    }

    @Post('me/assignment/submit-periodic-proof')
    @UseGuards(AuthGuard('jwt'), DriverGuard)
    @UseInterceptors(FileInterceptor('photo')) // Espera um único ficheiro no campo 'photo'
    async submitPeriodicProof(
        @Req() req,
        @UploadedFile(
            // Adicionamos validação básica de ficheiro (ex: max 5MB, apenas JPEG/PNG)
            new ParseFilePipe({
                validators: [
                    new MaxFileSizeValidator({ maxSize: 1024 * 1024 * 5 }),
                    new FileTypeValidator({ fileType: '.(png|jpeg|jpg)' }),
                ],
            }),
        ) file: Express.Multer.File,
        @Body() submitProofDto: SubmitProofDto, // Recebe os dados do corpo (proofType)
    ) {
        const user = req.user as User;
        const proof = await this.driversService.submitPeriodicProof(
            user,
            file,
            submitProofDto.proofType,
        );

        return {
            success: true,
            message: `Prova do tipo ${submitProofDto.proofType} enviada com sucesso.`,
            data: proof,
        };
    }

    @Post('me/wallet/withdraw')
    @UseGuards(AuthGuard('jwt'), DriverGuard)
    async requestWithdrawal(
        @Req() req,
        @Body() withdrawDto: WithdrawRequestDto,
    ) {
        const result = await this.driversService.requestWithdrawal(
            req.user as User,
            withdrawDto,
        );
        return {
            success: true,
            data: result,
        };
    }

    @Get('me/vehicles')
  @UseGuards(AuthGuard('jwt'), DriverGuard)
  async getMyVehicles(@Req() req) {
    const vehicles = await this.driversService.getMyVehicles(req.user as User);
    return {
      success: true,
      data: vehicles,
    };
  }
}
