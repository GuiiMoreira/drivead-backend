import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
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
    private storageService: StorageService,
  ) {}

  async createCampaign(user: User, createCampaignDto: CreateCampaignDto, file: Express.Multer.File) {
    // CORREÇÃO 1: Verificar se o usuário tem uma empresa vinculada
    if (!user.advertiserId) {
        throw new ForbiddenException('Usuário não vinculado a uma empresa (Advertiser). Crie a empresa primeiro.');
    }

    // CORREÇÃO 2: Usar o advertiserId diretamente do usuário
    const advertiserId = user.advertiserId;

    // Upload do arquivo
    const fileUrl = await this.storageService.uploadFile(
      file, 
      `campaigns/${advertiserId}/creatives`
    );

    // Cálculo do preço
    const priceData = this.calculatePrice({
      targetCategories: createCampaignDto.targetCategories,
      durationDays: createCampaignDto.durationDays,
      numCars: createCampaignDto.numCars,
      exposureLevel: createCampaignDto.exposureLevel,
    });

    const finalBudget = priceData.totalPrice;

    // Definição das datas
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + createCampaignDto.durationDays);

    // Criação da campanha
    const campaign = await this.prisma.campaign.create({
      data: {
        advertiserId: advertiserId, // CORREÇÃO 3: Usando a variável definida corretamente
        title: createCampaignDto.title,
        type: createCampaignDto.type,
        areaGeojson: createCampaignDto.area_geojson as any,
        startAt: startDate,
        endAt: endDate,
        budget: finalBudget,
        numCars: createCampaignDto.numCars,
        requirements: {
          targetCategory: priceData.selectedLowestCategory,
          exposureLevel: createCampaignDto.exposureLevel,
        } as any,
        creativeUrl: fileUrl,
        status: CampaignStatus.draft,
      },
    });

    return { campaign, priceData };
  }

  async getCampaignDetails(campaignId: string, user: User) {
    // CORREÇÃO 4: Validação de empresa via user.advertiserId
    if (!user.advertiserId) {
        throw new ForbiddenException('Usuário não vinculado a uma empresa.');
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException(`Campanha com ID "${campaignId}" não encontrada.`);
    }

    // Verifica se a campanha pertence à empresa do usuário
    if (campaign.advertiserId !== user.advertiserId) {
      throw new ForbiddenException('Você não tem permissão para aceder a esta campanha.');
    }

    return campaign;
  }

  async activateCampaign(user: User, campaignId: string) {
    // CORREÇÃO 5: Mesma lógica de validação
    if (!user.advertiserId) {
        throw new ForbiddenException('Usuário não vinculado a uma empresa.');
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException(`Campanha com ID "${campaignId}" não encontrada.`);
    }

    if (campaign.advertiserId !== user.advertiserId) {
      throw new ForbiddenException('Você não tem permissão para modificar esta campanha.');
    }

    if (campaign.status !== CampaignStatus.draft) {
      throw new ForbiddenException(`A campanha não está no estado 'draft' e não pode ser paga. Status atual: ${campaign.status}`);
    }

    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: CampaignStatus.active,
      },
    });
  }

  async generateCampaignReport(user: User, campaignId: string) {
    // CORREÇÃO 6: Mesma lógica de validação
    if (!user.advertiserId) {
        throw new ForbiddenException('Usuário não vinculado a uma empresa.');
    }

    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });

    if (!campaign) {
      throw new NotFoundException(`Campanha com ID "${campaignId}" não encontrada.`);
    }
    
    if (campaign.advertiserId !== user.advertiserId) {
      throw new ForbiddenException('Você não tem permissão para aceder a esta campanha.');
    }

    // ... (Resto da lógica de agregação permanece igual, está correta)
    const totalMetrics = await this.prisma.dailyAssignmentMetric.aggregate({
        where: { assignment: { campaignId: campaignId } },
        _sum: { kilometersDriven: true, timeInMotionSeconds: true },
    });

    const totalKm = totalMetrics._sum.kilometersDriven || 0;
    const totalTimeExposedHours = (totalMetrics._sum.timeInMotionSeconds || 0) / 3600;

    const driverMetrics = await this.prisma.dailyAssignmentMetric.groupBy({
        by: ['assignmentId'],
        where: { assignment: { campaignId: campaignId } },
        _sum: { kilometersDriven: true },
    });

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

    const TRAFFIC_FACTOR = 80;
    const estimatedImpressions = totalTimeExposedHours * TRAFFIC_FACTOR;
    const map_url = `https://maps.drivead.com/reports/${campaignId}`;

    return {
        map_url,
        total_km: parseFloat(totalKm.toFixed(2)),
        total_time_exposed_hours: parseFloat(totalTimeExposedHours.toFixed(2)),
        estimated_impressions: Math.round(estimatedImpressions),
        driver_breakdown: driverBreakdown,
    };
  }

  // ... (Método calculatePrice permanece igual, a lógica está correta e não depende de banco)
  calculatePrice(dto: CalculatePriceDto) {
    const VALOR_BASE_DIARIO_POR_CARRO = 15; 

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

    const categoryRanks = { ESSENTIAL: 1, SMART: 2, PRO: 2, PRIME: 3, ECO: 3 };
    let lowestCategory = dto.targetCategories[0];
    for (const category of dto.targetCategories) {
        if (categoryRanks[category] < categoryRanks[lowestCategory]) {
            lowestCategory = category;
        }
    }
    const baseCategoryCoefficient = categoryCoefficients[lowestCategory];

    const fatorArea = 1.0;

    const pricePerCarPerDay = VALOR_BASE_DIARIO_POR_CARRO *
        baseCategoryCoefficient *
        fatorArea *
        exposureFactors[dto.exposureLevel];

    const totalBasePrice = pricePerCarPerDay * dto.numCars * dto.durationDays;

    const finalPrice = totalBasePrice *
        durationFactors(dto.durationDays) *
        quantityFactors(dto.numCars);

    const pricePerCar = finalPrice / dto.numCars;

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
        estimatedImpressions: 450000,
    };
  }
}