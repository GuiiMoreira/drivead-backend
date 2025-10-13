import { Controller, Post, Body, UseGuards, Req, Get, Param, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { AdvertiserGuard } from '../core/guards/advertiser.guard';
import { PayCampaignDto } from './dto/pay-campaign.dto';
import { User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CalculatePriceDto } from './dto/calculate-price.dto';

@Controller('campaigns')
export class CampaignsController {
    constructor(private readonly campaignsService: CampaignsService, private prisma: PrismaService,) { }

    @Post()
    @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
    async createCampaign(@Req() req, @Body() createCampaignDto: CreateCampaignDto) {
        const user = req.user as User;
        const { campaign, priceData } = await this.campaignsService.createCampaign(user, createCampaignDto);

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
        @Body() payCampaignDto: PayCampaignDto, // Embora não usemos o DTO na lógica, ele valida o corpo da requisição
    ) {
        const user = req.user as User;
        const campaign = await this.campaignsService.activateCampaign(user, id);

        return {
            success: true,
            message: `Pagamento para a campanha "${campaign.title}" processado. Status alterado para: ${campaign.status}.`,
            data: campaign,
        };
    }

    // Endpoint útil para verificar o estado de uma campanha
    @Get(':id')
    @UseGuards(AuthGuard('jwt')) // Qualquer utilizador autenticado pode ver detalhes (ajustar regras se necessário)
    async getCampaignDetails(@Param('id', ParseUUIDPipe) id: string) {
        const campaign = await this.prisma.campaign.findUnique({ where: { id } }); // Adicionado para simplicidade, pode mover para o serviço
        if (!campaign) {
            throw new NotFoundException(`Campanha com ID "${id}" não encontrada.`);
        }
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
}