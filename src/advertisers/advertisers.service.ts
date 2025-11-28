import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAdvertiserDto } from './dto/update-advertiser.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { Advertiser, User, AdvertiserRole, PermissionLevel, CampaignStatus, AssignmentStatus } from '@prisma/client';
import { CreateAdvertiserDto } from './dto/create-advertiser.dto';
import { DashboardSummaryDto } from './dto/dashboard-summary.dto';

@Injectable()
export class AdvertisersService {
  constructor(private prisma: PrismaService) {}

  async createAdvertiser(user: User, dto: CreateAdvertiserDto) {
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

    // 3. Cria a Empresa e Atualiza o Usuário numa Transação
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
    // CORREÇÃO: Não podemos buscar Advertiser por userId.
    // Primeiro buscamos o usuário para saber qual é a empresa dele.
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
    // CORREÇÃO: Mesma lógica aqui. Buscamos o advertiserId através do usuário.
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
    // Verifica permissão
    if (adminUser.permissionLevel !== PermissionLevel.ADMIN) {
      throw new BadRequestException('Apenas administradores podem convidar membros.');
    }

    // Verifica se o usuário convidado já existe no sistema
    let user = await this.prisma.user.findUnique({
      where: { phone: dto.telefone },
    });

    if (!user) {
      // Se não existe, cria um pré-cadastro (Role padrão 'advertiser')
      user = await this.prisma.user.create({
        data: {
          phone: dto.telefone,
          name: dto.nome,
          role: 'advertiser', // Role do sistema
        },
      });
    }

    if (user.advertiserId) {
      throw new BadRequestException('Este usuário já pertence a outra empresa.');
    }

    // Vincula o usuário à empresa do admin
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

    // 1. Métricas de Campanhas (Ativas, Orçamento, Gasto)
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

    // Cálculo estimado do "Total Gasto" (Pro-rata baseado no tempo decorrido da campanha)
    let total_spent = 0;
    const now = new Date();
    for (const c of campaigns) {
      if (c.status === CampaignStatus.draft || c.status === CampaignStatus.pending_payment || c.status === CampaignStatus.cancelled) continue;
      
      const totalDuration = c.endAt.getTime() - c.startAt.getTime();
      const elapsed = now.getTime() - c.startAt.getTime();
      
      // Se a campanha já acabou, gastou tudo. Se ainda não começou, gastou 0.
      let percentage = 0;
      if (elapsed >= totalDuration) percentage = 1;
      else if (elapsed > 0) percentage = elapsed / totalDuration;

      total_spent += c.budget * percentage;
    }

    // 2. Métricas de Performance (KMs, Impressões) - Baseado nas métricas diárias
    // Buscamos métricas de todas as assignments ligadas às campanhas deste anunciante
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
    // Estimativa de impressões: Horas * Fator de Tráfego (ex: 80)
    const estimated_reach = Math.round((totalSeconds / 3600) * 80);

    // 3. Métricas de Carros
    // Carros contratados = soma de assignments ativos/instalados em todas as campanhas
    const cars_total_hired = campaigns.reduce((acc, c) => acc + c._count.assignments, 0);

    // Carros ativos agora: Motoristas que enviaram ping nos últimos 30 minutos
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const carsActiveNowCount = await this.prisma.position.groupBy({
      by: ['driverId'],
      where: {
        assignment: { campaign: { advertiserId } },
        ts: { gte: thirtyMinutesAgo }
      },
    });
    const cars_active_now = carsActiveNowCount.length;

    // 4. Performance Semanal (Últimos 7 dias)
    const weeklyData = [];
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);

      // Soma métricas do dia específico
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
        day_label: days[date.getDay()], // Pega o nome do dia (ex: "Seg")
        impressions: dayImpressions,
        intensity: 0 // Será calculado no front ou aqui se quisermos normalizar
      });
    }

    // Calcular intensidade relativa (0.0 a 1.0)
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