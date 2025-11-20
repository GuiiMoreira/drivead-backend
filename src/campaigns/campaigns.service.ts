import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { User, CampaignStatus } from '@prisma/client';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { StorageService } from '../storage/storage.service';

export enum ExposureLevel {
    BASIC = 'BASIC',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
}

@Injectable()
export class CampaignsService {
    constructor(
    private prisma: PrismaService,
    private storageService: StorageService, // <-- Injetar StorageService
  ) {}

    async createCampaign(user: User, createCampaignDto: CreateCampaignDto, file: Express.Multer.File) {
        // 1. Encontra ou cria o perfil de anunciante
        const advertiser = await this.prisma.advertiser.upsert({
            where: { userId: user.id },
            update: {},
            create: { userId: user.id },
        });

        const fileUrl = await this.storageService.uploadFile(
        file, 
        `campaigns/${advertiser.id}/creatives`
        );

        // 2. Chama a nossa função de cálculo de preço com os dados do DTO
        const priceData = this.calculatePrice({
            targetCategories: createCampaignDto.targetCategories,
            durationDays: createCampaignDto.durationDays,
            numCars: createCampaignDto.numCars,
            exposureLevel: createCampaignDto.exposureLevel,
        });

        const finalBudget = priceData.totalPrice;

        // 3. Define as datas de início e fim
        const startDate = new Date(); // A campanha começa "agora" após ser paga
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + createCampaignDto.durationDays);

        // 4. Cria a campanha com o budget calculado
        const campaign = await this.prisma.campaign.create({
            data: {
                advertiserId: advertiser.id,
                title: createCampaignDto.title,
                type: createCampaignDto.type,
                areaGeojson: createCampaignDto.area_geojson as any,
                startAt: startDate,
                endAt: endDate,
                budget: finalBudget, // <-- BUDGET CALCULADO AUTOMATICAMENTE
                numCars: createCampaignDto.numCars,
                requirements: {
                    targetCategory: priceData.selectedLowestCategory, // Guardamos a categoria base do preço
                    exposureLevel: createCampaignDto.exposureLevel,
                } as any,
                creativeUrl: fileUrl,
                status: CampaignStatus.draft,
            },
        });

        // Retornamos a campanha e o preço calculado para o frontend
        return { campaign, priceData };
    }

    async getCampaignDetails(campaignId: string, user: User) {
        const advertiser = await this.prisma.advertiser.findUnique({
            where: { userId: user.id },
        });

        if (!advertiser) {
            throw new ForbiddenException('Perfil de anunciante não encontrado para este utilizador.');
        }

        const campaign = await this.prisma.campaign.findUnique({
            where: { id: campaignId },
        });

        if (!campaign) {
            throw new NotFoundException(`Campanha com ID "${campaignId}" não encontrada.`);
        }

        if (campaign.advertiserId !== advertiser.id) {
            throw new ForbiddenException('Você não tem permissão para aceder a esta campanha.');
        }

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

    /**
  * Gera um relatório agregado de performance para uma campanha específica.
  */
    async generateCampaignReport(user: User, campaignId: string) {
        // 1. Validação de permissão (exatamente como no método activateCampaign)
        const advertiser = await this.prisma.advertiser.findUnique({ where: { userId: user.id } });
        const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });

        if (!campaign) {
            throw new NotFoundException(`Campanha com ID "${campaignId}" não encontrada.`);
        }
        if (!advertiser || campaign.advertiserId !== advertiser.id) {
            throw new ForbiddenException('Você não tem permissão para aceder a esta campanha.');
        }

        // 2. Agregação principal: Soma todos os KMs e segundos da campanha
        const totalMetrics = await this.prisma.dailyAssignmentMetric.aggregate({
            where: {
                assignment: {
                    campaignId: campaignId,
                },
            },
            _sum: {
                kilometersDriven: true,
                timeInMotionSeconds: true, // Assumindo que você irá adicionar este campo no futuro
            },
        });

        const totalKm = totalMetrics._sum.kilometersDriven || 0;
        const totalTimeExposedHours = (totalMetrics._sum.timeInMotionSeconds || 0) / 3600;

        // 3. Agregação por motorista (Driver Breakdown)
        const driverMetrics = await this.prisma.dailyAssignmentMetric.groupBy({
            by: ['assignmentId'],
            where: {
                assignment: {
                    campaignId: campaignId,
                },
            },
            _sum: {
                kilometersDriven: true,
            },
        });

        // Para enriquecer o breakdown, buscamos os detalhes de cada assignment
        const assignmentsDetails = await this.prisma.assignment.findMany({
            where: { id: { in: driverMetrics.map(m => m.assignmentId) } },
            select: { id: true, driverId: true }
        });

        const driverBreakdown = driverMetrics.map(metric => {
            const detail = assignmentsDetails.find(d => d.id === metric.assignmentId);
            return {
                driver_id: detail?.driverId,
                km: metric._sum.kilometersDriven,
            }
        });

        // 4. Cálculos e placeholders para o MVP
        const TRAFFIC_FACTOR = 80; // Fator configurável, como na sua documentação
        const estimatedImpressions = totalTimeExposedHours * TRAFFIC_FACTOR;

        // A URL do mapa seria gerada por um serviço de mapas ou pelo frontend
        const map_url = `https://maps.drivead.com/reports/${campaignId}`;

        return {
            map_url,
            total_km: parseFloat(totalKm.toFixed(2)),
            total_time_exposed_hours: parseFloat(totalTimeExposedHours.toFixed(2)),
            estimated_impressions: Math.round(estimatedImpressions),
            driver_breakdown: driverBreakdown,
        };
    }

    calculatePrice(dto: CalculatePriceDto) {
        // --- Fatores de Precificação ---
        const VALOR_BASE_DIARIO_POR_CARRO = 15; // R$ 450/mês / 30 dias

        const categoryCoefficients = {
            ESSENTIAL: 1.0,
            SMART: 1.5,
            PRO: 1.2,
            PRIME: 2.0,
            ECO: 2.2,
        };

        const durationFactors = (days: number) => {
            if (days >= 90) return 0.8;
            if (days >= 60) return 0.85;
            if (days >= 30) return 0.9;
            return 1.0;
        };

        const quantityFactors = (cars: number) => {
            if (cars > 100) return 0.85;
            if (cars > 50) return 0.9;
            if (cars > 10) return 0.95;
            return 1.0;
        };

        const exposureFactors = {
            BASIC: 1.0,
            MEDIUM: 1.2,
            HIGH: 1.4,
        };

        // --- Lógica da Regra de Negócio: Usar a categoria mais baixa ---
        const categoryRanks = { ESSENTIAL: 1, SMART: 2, PRO: 2, PRIME: 3, ECO: 3 };
        let lowestCategory = dto.targetCategories[0];
        for (const category of dto.targetCategories) {
            if (categoryRanks[category] < categoryRanks[lowestCategory]) {
                lowestCategory = category;
            }
        }
        const baseCategoryCoefficient = categoryCoefficients[lowestCategory];
        // -----------------------------------------------------------------

        const fatorArea = 1.0; // Fixo em 1.0 para o MVP, conforme solicitado

        // --- Aplicação da Fórmula ---
        const pricePerCarPerDay = VALOR_BASE_DIARIO_POR_CARRO *
            baseCategoryCoefficient *
            fatorArea *
            exposureFactors[dto.exposureLevel];

        const totalBasePrice = pricePerCarPerDay * dto.numCars * dto.durationDays;

        const finalPrice = totalBasePrice *
            durationFactors(dto.durationDays) *
            quantityFactors(dto.numCars);

        const pricePerCar = finalPrice / dto.numCars;

        // TODO: Implementar lógica para estimar impressões

        return {
            totalPrice: parseFloat(finalPrice.toFixed(2)),
            pricePerCar: parseFloat(pricePerCar.toFixed(2)),
            pricePerCarPerMonth: parseFloat((pricePerCar / dto.durationDays * 30).toFixed(2)),
            selectedLowestCategory: lowestCategory,
            details: {
                baseCategoryCoefficient,
                durationFactor: durationFactors(dto.durationDays),
                quantityFactor: quantityFactors(dto.numCars),
            },
            estimatedImpressions: 450000, // Placeholder
        };
    }
}
