import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { User, CampaignStatus } from '@prisma/client';

@Injectable()
export class CampaignsService {
    constructor(private prisma: PrismaService) { }

    async createCampaign(user: User, createCampaignDto: CreateCampaignDto) {
        // 1. Encontra ou cria o perfil de anunciante para o utilizador
        const advertiser = await this.prisma.advertiser.upsert({
            where: { userId: user.id },
            update: {},
            create: {
                userId: user.id,
                // Em um fluxo mais completo, pediríamos companyName, etc.
            },
        });

        // 2. Cria a campanha associada a este anunciante
        const campaign = await this.prisma.campaign.create({
            data: {
                advertiserId: advertiser.id,
                title: createCampaignDto.title,
                type: createCampaignDto.type,
                areaGeojson: createCampaignDto.area_geojson as any, // Prisma espera JsonValue
                startAt: new Date(createCampaignDto.start),
                endAt: new Date(createCampaignDto.end),
                budget: createCampaignDto.budget,
                numCars: createCampaignDto.num_cars,
                requirements: (createCampaignDto.preferences as any) ?? {},
                creativeUrl: createCampaignDto.creative.file_url,
                status: CampaignStatus.draft, // Campanhas começam como rascunho até o pagamento [cite: 94]
            },
        });

        return campaign;
    }

    /**
  * Ativa uma campanha, simulando um pagamento bem-sucedido.
  * Altera o status da campanha de 'draft' para 'active'.
  * @param user - O utilizador anunciante autenticado.
  * @param campaignId - O ID da campanha a ser ativada.
  */
    async activateCampaign(user: User, campaignId: string) {
        // Primeiro, encontramos o perfil de anunciante do utilizador
        const advertiser = await this.prisma.advertiser.findUnique({
            where: { userId: user.id },
        });

        if (!advertiser) {
            throw new ForbiddenException('Perfil de anunciante não encontrado para este utilizador.');
        }

        // Agora, encontramos a campanha e garantimos que ela pertence a este anunciante
        const campaign = await this.prisma.campaign.findUnique({
            where: { id: campaignId },
        });

        if (!campaign) {
            throw new NotFoundException(`Campanha com ID "${campaignId}" não encontrada.`);
        }

        if (campaign.advertiserId !== advertiser.id) {
            throw new ForbiddenException('Você não tem permissão para modificar esta campanha.');
        }

        if (campaign.status !== CampaignStatus.draft) {
            throw new ForbiddenException(`A campanha não está no estado 'draft' e não pode ser paga. Status atual: ${campaign.status}`);
        }

        // Atualiza o status da campanha para 'active'
        return this.prisma.campaign.update({
            where: { id: campaignId },
            data: {
                status: CampaignStatus.active,
            },
        });
    }
}