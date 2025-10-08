import { Controller, Post, Body, UseGuards, Req, Get, Param, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { AdvertiserGuard } from '../core/guards/advertiser.guard';
import { PayCampaignDto } from './dto/pay-campaign.dto';
import { User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

@Controller('campaigns')
export class CampaignsController {
    constructor(private readonly campaignsService: CampaignsService, private prisma: PrismaService,) { }

    @Post()
    @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
    async createCampaign(@Req() req, @Body() createCampaignDto: CreateCampaignDto) {
        const user = req.user as User;
        const campaign = await this.campaignsService.createCampaign(user, createCampaignDto);

        return {
            success: true,
            message: 'Campanha criada como rascunho com sucesso.',
            data: campaign,
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
}