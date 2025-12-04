import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { User, CampaignStatus, AssignmentStatus, ProofRequestStatus } from '@prisma/client';
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

    // Criação da campanha
    const campaign = await this.prisma.campaign.create({
      data: {
        advertiserId: advertiserId, // CORREÇÃO 3: Usando a variável definida corretamente
        title: createCampaignDto.title,
        type: createCampaignDto.type,
        areaGeojson: createCampaignDto.area_geojson as any,
        startAt: new Date(),
        // Se quiser suportar validade global no futuro, adicione ao DTO. Por enquanto, null ou calculado.
        // Para o MVP, vamos deixar null para seguir a sua lógica de "sem validade fixa".
        endAt: null, 
        durationDays: createCampaignDto.durationDays,
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
    // 1. Validações (permissão) - Mantém igual
    if (!user.advertiserId) throw new ForbiddenException('Usuário não vinculado a uma empresa.');
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException(`Campanha não encontrada.`);
    if (campaign.advertiserId !== user.advertiserId) throw new ForbiddenException('Acesso negado.');

    // 2. Métricas Acumuladas
    const totalMetrics = await this.prisma.dailyAssignmentMetric.aggregate({
      where: { assignment: { campaignId } },
      _sum: { kilometersDriven: true, timeInMotionSeconds: true },
      _avg: { timeInMotionSeconds: true } // Média de tempo
    });

    const totalKm = totalMetrics._sum.kilometersDriven || 0;
    const totalSeconds = totalMetrics._sum.timeInMotionSeconds || 0;
    const avgSeconds = totalMetrics._avg.timeInMotionSeconds || 0;
    
    const TRAFFIC_FACTOR = 80;
    const estimatedImpressions = Math.round((totalSeconds / 3600) * TRAFFIC_FACTOR);
    const avgTimeHours = avgSeconds / 3600;

    // 3. Performance Diária (Gráfico)
    // Agrupa por data. Nota: Prisma não agrupa por data facilmente em todos os DBs,
    // mas como temos o campo `date` limpo no DailyAssignmentMetric, funciona bem.
    const dailyMetrics = await this.prisma.dailyAssignmentMetric.groupBy({
      by: ['date'],
      where: { assignment: { campaignId } },
      _sum: { timeInMotionSeconds: true },
      orderBy: { date: 'asc' }
    });

    const dailyPerformance = dailyMetrics.map(m => {
      const daySeconds = m._sum.timeInMotionSeconds || 0;
      const dayImpressions = Math.round((daySeconds / 3600) * TRAFFIC_FACTOR);
      
      // Formata data para "DD/MM"
      const day = m.date.getDate().toString().padStart(2, '0');
      const month = (m.date.getMonth() + 1).toString().padStart(2, '0');

      return {
        day_label: `${day}/${month}`,
        impressions: dayImpressions
      };
    });

    // 4. Lista de Top Motoristas
    // Precisamos buscar os dados agregados por motorista e os dados do motorista (nome/foto)
    const driverMetrics = await this.prisma.dailyAssignmentMetric.groupBy({
      by: ['assignmentId'],
      where: { assignment: { campaignId } },
      _sum: { kilometersDriven: true, timeInMotionSeconds: true },
      orderBy: { _sum: { kilometersDriven: 'desc' } }, // Top KMs
      take: 10 // Top 10
    });

    const assignments = await this.prisma.assignment.findMany({
      where: { id: { in: driverMetrics.map(m => m.assignmentId) } },
      include: {
        driver: {
          include: {
            user: { select: { name: true } }, // Nome do usuário
            // Aqui você pegaria a foto do perfil se tivesse (ex: kycDocuments selfie)
            kycDocuments: { where: { docType: 'selfie' }, select: { fileUrl: true }, take: 1 }
          }
        }
      }
    });

    const driversList = driverMetrics.map(metric => {
      const assign = assignments.find(a => a.id === metric.assignmentId);
      const seconds = metric._sum.timeInMotionSeconds || 0;
      
      return {
        driver_id: assign?.driverId,
        name: assign?.driver?.user?.name || 'Motorista',
        photo_url: assign?.driver?.kycDocuments?.[0]?.fileUrl || null, // Pega a selfie como avatar
        km: parseFloat((metric._sum.kilometersDriven || 0).toFixed(1)),
        hours: parseFloat((seconds / 3600).toFixed(1))
      };
    });

    // URL do mapa (Placeholder por enquanto, ou lógica real se tiver)
    const map_url = null; // O front vai mostrar placeholder se for null

    return {
      total_km: parseFloat(totalKm.toFixed(1)),
      estimated_impressions: estimatedImpressions,
      avg_time_hours: parseFloat(avgTimeHours.toFixed(1)),
      map_url: map_url,
      daily_performance: dailyPerformance,
      drivers: driversList
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

  /**
   * Encerra manualmente uma campanha antes do prazo.
   * - Muda status da campanha para 'finished'.
   * - Solicita prova final a todos os motoristas ativos.
   */
  async stopCampaignManual(user: User, campaignId: string) {
    // 1. Validações de Permissão
    if (!user.advertiserId) {
        throw new ForbiddenException('Usuário não vinculado a uma empresa.');
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId }
    });

    if (!campaign) {
        throw new NotFoundException('Campanha não encontrada.');
    }

    if (campaign.advertiserId !== user.advertiserId) {
        throw new ForbiddenException('Você não tem permissão para modificar esta campanha.');
    }

    if (campaign.status !== CampaignStatus.active) {
        throw new BadRequestException(`A campanha não está ativa (Status atual: ${campaign.status}).`);
    }

    // 2. Encerra a campanha
    await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.finished }
    });

    // 3. Notifica motoristas (marca para prova final)
    // Atualiza apenas os motoristas que estão ativos
    const updateResult = await this.prisma.assignment.updateMany({
        where: { 
            campaignId: campaignId, 
            status: AssignmentStatus.active 
        },
        data: { 
            proofStatus: ProofRequestStatus.PENDING_FINAL 
            // Opcional: Se quiser "travar" a contagem de KMs imediatamente,
            // pode mudar o status para algo como 'finishing' ou manter 'active' até a prova.
        }
    });

    return { 
        message: 'Campanha encerrada com sucesso.', 
        affectedDrivers: updateResult.count 
    };
  }
}