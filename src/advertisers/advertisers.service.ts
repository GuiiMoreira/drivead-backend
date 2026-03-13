import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service'; // <-- Importado o serviço de S3
import { UpdateAdvertiserDto } from './dto/update-advertiser.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { Advertiser, User, AdvertiserRole, PermissionLevel, CampaignStatus, AssignmentStatus } from '@prisma/client';
import { CreateAdvertiserDto } from './dto/create-advertiser.dto';
import { DashboardSummaryDto } from './dto/dashboard-summary.dto';

@Injectable()
export class AdvertisersService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService // <-- Injetado no construtor
  ) {}

  async createAdvertiser(
    user: User, 
    dto: CreateAdvertiserDto, 
    files?: { docCnpj?: Express.Multer.File[], docContrato?: Express.Multer.File[], docResponsavel?: Express.Multer.File[] }
  ) {
    // 1. Verifica se o usuário já tem uma empresa
    if (user.advertiserId) {
      throw new BadRequestException('Este usuário já pertence a uma empresa.');
    }

    // 2. Verifica se o CNPJ já existe
    const existingCnpj = await this.prisma.advertiser.findUnique({
      where: { cnpj: dto.cnpj },
    });
    if (existingCnpj) {
      throw new BadRequestException('CNPJ já cadastrado.');
    }

    // 3. Upload dos Documentos para o AWS S3 (se enviados)
    let docCnpjUrl = null;
    let docContratoUrl = null;
    let docResponsavelUrl = null;

    // Removemos pontuações do CNPJ para usar como nome da pasta no S3
    const cleanCnpj = dto.cnpj.replace(/\D/g, ''); 

    if (files?.docCnpj && files.docCnpj.length > 0) {
      docCnpjUrl = await this.storageService.uploadFile(files.docCnpj[0], `advertisers/${cleanCnpj}/docs`);
    }
    if (files?.docContrato && files.docContrato.length > 0) {
      docContratoUrl = await this.storageService.uploadFile(files.docContrato[0], `advertisers/${cleanCnpj}/docs`);
    }
    if (files?.docResponsavel && files.docResponsavel.length > 0) {
      docResponsavelUrl = await this.storageService.uploadFile(files.docResponsavel[0], `advertisers/${cleanCnpj}/docs`);
    }

    // 4. Cria a Empresa e Atualiza o Usuário numa Transação
    return this.prisma.$transaction(async (tx) => {
      // Cria a empresa
      const newAdvertiser = await tx.advertiser.create({
        data: {
          type: dto.tipo_empresa,
          cnpj: dto.cnpj,
          razaoSocial: dto.razao_social,
          nomeFantasia: dto.nome_fantasia,
          segmento: dto.segmento,
          // Mapeamento do Endereço
          logradouro: dto.endereco.logradouro,
          numero: dto.endereco.numero,
          complemento: dto.endereco.complemento,
          bairro: dto.endereco.bairro,
          cidade: dto.endereco.cidade,
          estado: dto.endereco.estado,
          cep: dto.endereco.cep,
          // Configs
          budgetLimit: dto.limite_orcamento_mensal,
          isAgencyMode: dto.modo_agencia,
          // Arquivos Upados (Usando os nomes EXATOS do seu schema.prisma)
          docCartaoCnpjUrl: docCnpjUrl,
          docContratoSocialUrl: docContratoUrl,
          docResponsavelUrl: docResponsavelUrl,
        },
      });

      // Atualiza o usuário atual para ser o ADMIN desta empresa
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          advertiserId: newAdvertiser.id,
          teamRole: AdvertiserRole.ADMINISTRADOR, // Cargo padrão do criador
          permissionLevel: PermissionLevel.ADMIN, // Permissão máxima
        },
      });

      return { advertiser: newAdvertiser, user: updatedUser };
    });
  }

  async getCampaigns(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { advertiserId: true },
    });

    if (!user || !user.advertiserId) {
      throw new NotFoundException('Anunciante não encontrado ou usuário sem empresa vinculada.');
    }

    return this.prisma.campaign.findMany({
      where: { advertiserId: user.advertiserId },
    });
  }

  async updateAdvertiser(
    userId: string,
    data: UpdateAdvertiserDto,
  ): Promise<Advertiser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { advertiserId: true },
    });

    if (!user || !user.advertiserId) {
      throw new NotFoundException('Anunciante não encontrado para este usuário.');
    }

    return this.prisma.advertiser.update({
      where: { id: user.advertiserId },
      data,
    });
  }

  async inviteMember(adminUser: User, dto: InviteMemberDto) {
    if (adminUser.permissionLevel !== PermissionLevel.ADMIN) {
      throw new BadRequestException('Apenas administradores podem convidar membros.');
    }

    let user = await this.prisma.user.findUnique({
      where: { phone: dto.telefone },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone: dto.telefone,
          name: dto.nome,
          role: 'advertiser', 
        },
      });
    }

    if (user.advertiserId) {
      throw new BadRequestException('Este usuário já pertence a outra empresa.');
    }

    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        advertiserId: adminUser.advertiserId,
        teamRole: dto.cargo,
        permissionLevel: dto.permissao,
      },
    });
  }

  async getDashboardSummary(user: User): Promise<DashboardSummaryDto> {
    if (!user.advertiserId) {
      throw new BadRequestException('Usuário não vinculado a um anunciante.');
    }

    const advertiserId = user.advertiserId;

    const campaigns = await this.prisma.campaign.findMany({
      where: { advertiserId },
      include: {
        _count: {
          select: {
            assignments: {
              where: { status: { in: [AssignmentStatus.active, AssignmentStatus.installed] } }
            }
          }
        }
      }
    });

    const active_campaigns_count = campaigns.filter(c => c.status === CampaignStatus.active).length;
    const total_budget = campaigns.reduce((acc, c) => acc + c.budget, 0);

    let total_spent = 0;
    const now = new Date();
    for (const c of campaigns) {
      if (c.status === CampaignStatus.draft || c.status === CampaignStatus.pending_payment || c.status === CampaignStatus.cancelled) continue;
      
      const totalDuration = c.endAt.getTime() - c.startAt.getTime();
      const elapsed = now.getTime() - c.startAt.getTime();
      
      let percentage = 0;
      if (elapsed >= totalDuration) percentage = 1;
      else if (elapsed > 0) percentage = elapsed / totalDuration;

      total_spent += c.budget * percentage;
    }

    const metrics = await this.prisma.dailyAssignmentMetric.aggregate({
      where: {
        assignment: {
          campaign: { advertiserId }
        }
      },
      _sum: {
        kilometersDriven: true,
        timeInMotionSeconds: true
      }
    });

    const total_km_driven = metrics._sum.kilometersDriven || 0;
    const totalSeconds = metrics._sum.timeInMotionSeconds || 0;
    const estimated_reach = Math.round((totalSeconds / 3600) * 80);

    const cars_total_hired = campaigns.reduce((acc, c) => acc + c._count.assignments, 0);

    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const carsActiveNowCount = await this.prisma.position.groupBy({
      by: ['driverId'],
      where: {
        assignment: { campaign: { advertiserId } },
        ts: { gte: thirtyMinutesAgo }
      },
    });
    const cars_active_now = carsActiveNowCount.length;

    const weeklyData = [];
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);

      const dayMetrics = await this.prisma.dailyAssignmentMetric.aggregate({
        where: {
          assignment: { campaign: { advertiserId } },
          date: { gte: date, lt: nextDate }
        },
        _sum: { timeInMotionSeconds: true }
      });

      const daySeconds = dayMetrics._sum.timeInMotionSeconds || 0;
      const dayImpressions = Math.round((daySeconds / 3600) * 80);

      weeklyData.push({
        day_label: days[date.getDay()],
        impressions: dayImpressions,
        intensity: 0 
      });
    }

    const maxImpressions = Math.max(...weeklyData.map(d => d.impressions)) || 1;
    weeklyData.forEach(d => d.intensity = parseFloat((d.impressions / maxImpressions).toFixed(2)));

    return {
      active_campaigns_count,
      total_spent: parseFloat(total_spent.toFixed(2)),
      total_budget: parseFloat(total_budget.toFixed(2)),
      estimated_reach,
      total_km_driven: parseFloat(total_km_driven.toFixed(2)),
      cars_active_now,
      cars_total_hired,
      weekly_performance: weeklyData
    };
  }
}