import { Controller, Post, Body, UseGuards, Req, Get, Param, ParseUUIDPipe, NotFoundException, UploadedFile, BadRequestException, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { AdvertiserGuard } from '../core/guards/advertiser.guard';
import { PayCampaignDto } from './dto/pay-campaign.dto';
import { User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { PaymentsService } from '../payments/payments.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('campaigns')
export class CampaignsController {
    constructor(private readonly campaignsService: CampaignsService,
        private prisma: PrismaService,
        private readonly paymentsService: PaymentsService,) { }

    @Post()
    @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
    @UseInterceptors(FileInterceptor('file')) // <-- Intercepta o campo 'file'
    async createCampaign(
        @Req() req,
        @Body() body: { data: string }, // Recebe o JSON como string no campo 'data'
        @UploadedFile() file: Express.Multer.File // Recebe o arquivo
    ) {
        if (!file) {
            throw new BadRequestException('A imagem do criativo é obrigatória.');
        }

        let createCampaignDto: CreateCampaignDto;
        try {
            createCampaignDto = JSON.parse(body.data);
        } catch (e) {
            throw new BadRequestException('Formato de dados inválido.');
        }

        const user = req.user as User;

        const { campaign, priceData } = await this.campaignsService.createCampaign(user, createCampaignDto, file);

        return {
            success: true,
            message: 'Campanha criada como rascunho com sucesso.',
            data: {
                campaign,
                priceDetails: priceData,
            },
        };
    }

    @Post(':id/pay')
    @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
    async payForCampaign(
        @Req() req,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() payCampaignDto: PayCampaignDto, // DTO de pagamento
    ) {
        const user = req.user as User;
        
        // CORREÇÃO: O serviço agora retorna uma STRING (URL de redirecionamento)
        // por causa da mudança para Checkout Pro
        const redirectUrl = await this.paymentsService.createPaymentOrder(id, user);

        return {
            success: true,
            message: 'Link de pagamento gerado com sucesso.',
            data: {
                // O frontend deve redirecionar o usuário para esta URL
                paymentUrl: redirectUrl, 
            },
        };
    }

    // Endpoint útil para verificar o estado de uma campanha
    @Get(':id')
    @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
    async getCampaignDetails(
        @Req() req,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        const user = req.user as User;
        const campaign = await this.campaignsService.getCampaignDetails(id, user);
        return {
            success: true,
            data: campaign,
        };
    }

    @Get(':id/report')
    @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
    async getCampaignReport(@Req() req, @Param('id', ParseUUIDPipe) id: string) {
        const user = req.user as User;
        const reportData = await this.campaignsService.generateCampaignReport(user, id);

        return {
            success: true,
            data: reportData,
        };
    }

    @Post('calculate-price')
    @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
    calculateCampaignPrice(@Body() calculatePriceDto: CalculatePriceDto) {
        const priceData = this.campaignsService.calculatePrice(calculatePriceDto);
        return {
            success: true,
            data: priceData,
        };
    }

    @Post(':id/stop')
    @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
    async stopCampaign(@Req() req, @Param('id', ParseUUIDPipe) id: string) {
        const user = req.user as User;
        const result = await this.campaignsService.stopCampaignManual(user, id);

        return {
            success: true,
            message: result.message,
            data: result
        };
    }
}