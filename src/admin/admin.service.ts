import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KycStatus, TransactionStatus, AssignmentStatus, ProofRequestStatus, CampaignStatus } from '@prisma/client';

@Injectable()
export class AdminService {
    constructor(private prisma: PrismaService) { }

    // =================================================================
  // GESTÃO DE CAMPANHAS
  // =================================================================

  /**
   * Lista campanhas que foram pagas mas aguardam moderação.
   */
 async listPendingCampaigns() {
    return this.prisma.campaign.findMany({
      where: { status: CampaignStatus.pending_approval },
      include: {
        advertiser: {
          include: {
            // CORREÇÃO: Mudamos de 'user' para 'users'
            users: {
              select: { name: true, email: true, teamRole: true },
              take: 1, // Pegamos apenas 1 (geralmente o admin) para exibir o contato
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  /**
   * Aprova ou rejeita uma campanha.
   */
  async reviewCampaign(campaignId: string, action: 'approve' | 'reject', reason?: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');

    const newStatus = action === 'approve' ? CampaignStatus.active : CampaignStatus.rejected;

    // Se aprovada, definimos a data de início real para "agora" se a data original já passou
    let updateData: any = { status: newStatus };
    
    if (action === 'approve') {
       const now = new Date();
       if (campaign.startAt < now) {
         updateData.startAt = now; // Ajusta início para não começar no passado
       }
    }

    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: updateData,
    });
    
    // TODO: Se 'reject', implementar lógica de estorno do pagamento (refund) no gateway.
  }

  // =================================================================
  // GESTÃO DE FRAUDE
  // =================================================================

  /**
   * Lista alertas de fraude (Assignments marcados como 'fraud').
   */
  async listFraudAlerts() {
    return this.prisma.assignment.findMany({
      where: { status: AssignmentStatus.fraud },
      include: {
        driver: { include: { user: { select: { name: true } } } },
        campaign: { select: { title: true } }
      }
    });
  }

  /**
   * Resolve um alerta de fraude (Ignorar ou Penalizar).
   */
  async resolveFraudAlert(assignmentId: string, action: 'dismiss' | 'penalize', notes?: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('Alerta não encontrado.');

    return this.prisma.$transaction(async (tx) => {
      if (action === 'dismiss') {
        // Falso positivo: volta para o status 'active'
        await tx.assignment.update({
          where: { id: assignmentId },
          data: { status: AssignmentStatus.active }
        });
        return { message: 'Alerta ignorado. Motorista ativo novamente.' };
      } 
      
      if (action === 'penalize') {
        // Fraude confirmada: Mantém como fraude (ou muda para 'rejected'/'removed') e aplica penalidade
        // Exemplo: Remover da campanha definitivamente
        await tx.assignment.update({
          where: { id: assignmentId },
          data: { status: AssignmentStatus.removed } // Remove da campanha
        });
        
        // Registrar penalidade (AuditLog ou lógica de saldo se houver multa)
        await tx.auditLog.create({
          data: {
            action: 'FRAUD_PENALTY',
            entityType: 'Assignment',
            entityId: assignmentId,
            payload: { notes, penaltyApplied: true }
          }
        });

        return { message: 'Motorista penalizado e removido da campanha.' };
      }
    });
  }

    /**
     * Lista todos os motoristas cujo status de KYC é 'pending'.
     */
    async listPendingDrivers() {
        return this.prisma.driver.findMany({
            where: {
                kycStatus: KycStatus.pending,
            },
            include: {
                user: {
                    select: { name: true, phone: true, email: true, createdAt: true },
                },
                vehicles: true,
                kycDocuments: true,
            },
        });
    }

    /**
     * Aprova um motorista, mudando o seu status de KYC para 'approved'.
     */
    async approveDriver(driverId: string) {
        const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });

        if (!driver) {
            throw new NotFoundException(`Perfil de motorista com ID "${driverId}" não encontrado.`);
        }

        return this.prisma.driver.update({
            where: { id: driverId },
            data: { kycStatus: KycStatus.approved },
        });
    }

    /**
     * Processa o pagamento (crédito na carteira) para uma atribuição finalizada.
     */
    async processAssignmentPayout(assignmentId: string) {
        const assignment = await this.prisma.assignment.findUnique({
            where: { id: assignmentId },
            include: { campaign: true },
        });

        if (!assignment) { throw new NotFoundException('Atribuição não encontrada.'); }
        if (assignment.payoutProcessedAt) { throw new ConflictException('O pagamento já foi processado.'); }

        const payoutAmount = assignment.payoutAmount;
        if (!payoutAmount || payoutAmount <= 0) { throw new ForbiddenException('Valor de pagamento inválido.'); }

        return this.prisma.$transaction(async (tx) => {
            const wallet = await tx.driverWallet.upsert({
                where: { driverId: assignment.driverId },
                update: { balance: { increment: payoutAmount } },
                create: { driverId: assignment.driverId, balance: payoutAmount },
            });

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    amount: payoutAmount,
                    type: 'CREDIT',
                    status: TransactionStatus.COMPLETED, // Créditos entram como concluídos
                    description: `Pagamento da campanha: ${assignment.campaign.title}`,
                },
            });

            return tx.assignment.update({
                where: { id: assignmentId },
                data: { payoutProcessedAt: new Date() },
            });
        });
    }

    /**
     * Lista solicitações de saque pendentes.
     */
    async listPendingWithdrawals() {
        return this.prisma.walletTransaction.findMany({
            where: { type: 'DEBIT', status: TransactionStatus.PENDING },
            include: {
                wallet: {
                    include: {
                        driver: {
                            include: { user: { select: { name: true, phone: true } } },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });
    }

    /**
     * Aprova uma solicitação de saque.
     */
    async approveWithdrawal(transactionId: string) {
        const transaction = await this.prisma.walletTransaction.findUnique({ where: { id: transactionId } });

        if (!transaction) { throw new NotFoundException('Solicitação não encontrada.'); }
        if (transaction.status !== TransactionStatus.PENDING) { throw new ConflictException(`Status inválido: ${transaction.status}`); }

        return this.prisma.walletTransaction.update({
            where: { id: transactionId },
            data: { status: TransactionStatus.COMPLETED },
        });
    }

    // --- NOVOS MÉTODOS DE APROVAÇÃO DE PROVAS ---

    /**
     * Lista instalações pendentes de aprovação.
     */
    async listPendingInstallations() {
        return this.prisma.installProof.findMany({
            where: { status: 'PENDING' },
            include: {
                assignment: {
                    include: {
                        driver: { include: { user: { select: { name: true, phone: true } } } },
                        campaign: { select: { title: true } },
                        vehicle: true,
                    },
                },
            },
        });
    }

    /**
     * Aprova ou rejeita uma instalação.
     */
    async reviewInstallation(proofId: string, approved: boolean, notes?: string) {
        return this.prisma.$transaction(async (tx) => {
            const proof = await tx.installProof.update({
                where: { id: proofId },
                data: {
                    status: approved ? 'APPROVED' : 'REJECTED',
                    adminNotes: notes,
                    reviewedAt: new Date(),
                },
            });

            if (approved) {
                // Se aprovado, a campanha começa oficialmente!
                await tx.assignment.update({
                    where: { id: proof.assignmentId },
                    data: {
                        status: AssignmentStatus.active,
                        installedAt: new Date(),
                    },
                });
            } else {
                // Se rejeitado, volta para 'accepted' para o motorista tentar de novo
                await tx.assignment.update({
                    where: { id: proof.assignmentId },
                    data: { status: AssignmentStatus.accepted },
                });
            }

            return proof;
        });
    }

    /**
     * Lista provas periódicas pendentes.
     */
    async listPendingPeriodicProofs() {
        return this.prisma.periodicProof.findMany({
            where: { status: 'PENDING' },
            include: {
                assignment: {
                    include: {
                        driver: { include: { user: { select: { name: true, phone: true } } } },
                        campaign: { select: { title: true } },
                    },
                },
            },
        });
    }

    /**
     * Aprova ou rejeita uma prova periódica.
     */
    async reviewPeriodicProof(proofId: string, approved: boolean, notes?: string) {
        return this.prisma.$transaction(async (tx) => {
            const proof = await tx.periodicProof.update({
                where: { id: proofId },
                data: {
                    status: approved ? 'APPROVED' : 'REJECTED',
                    adminNotes: notes,
                    reviewedAt: new Date(),
                },
            });

            if (!approved && proof.proofType === 'RANDOM') {
                // Se rejeitou uma prova aleatória, reativa a solicitação para o motorista enviar outra
                await tx.assignment.update({
                    where: { id: proof.assignmentId },
                    data: { proofStatus: ProofRequestStatus.PENDING_RANDOM },
                });
            }

            return proof;
        });
    }

    /**
   * 1. Dashboard Geral (KPIs)
   * Retorna contagens de motoristas, campanhas e receita mensal.
   */
  async getDashboardStats() {
    // Motoristas rodando ativamente (Assignments com status 'active')
    const activeDrivers = await this.prisma.assignment.count({
      where: { status: AssignmentStatus.active },
    });

    // Motoristas aguardando aprovação de cadastro
    const pendingApprovals = await this.prisma.driver.count({
      where: { kycStatus: KycStatus.pending },
    });

    // Campanhas ativas no momento
    const activeCampaigns = await this.prisma.campaign.count({
      where: { status: 'active' },
    });

    // Receita do mês (Soma dos budgets de campanhas criadas neste mês que não são rascunho)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const revenue = await this.prisma.campaign.aggregate({
      where: {
        createdAt: { gte: startOfMonth },
        status: { not: 'draft' }, // Considera tudo que já foi "fechado" (pago)
      },
      _sum: { budget: true },
    });

    return {
      active_drivers: activeDrivers,
      pending_approvals: pendingApprovals,
      active_campaigns: activeCampaigns,
      total_revenue_month: revenue._sum.budget || 0,
    };
  }

  /**
   * 4. Monitoramento em Tempo Real
   * Retorna a última posição conhecida de cada motorista ativo.
   */
  async getActiveDriversLocations() {
    // 1. Busca todas as assignments que estão rodando (status 'active')
    const activeAssignments = await this.prisma.assignment.findMany({
      where: { status: AssignmentStatus.active },
      include: {
        driver: {
          include: {
            user: { select: { name: true } },
            vehicles: { take: 1 }, // Pega o carro principal
          },
        },
        campaign: { select: { title: true } },
      },
    });

    const results = [];
    const now = new Date().getTime();

    // 2. Para cada motorista, busca a última posição registrada
    for (const assignment of activeAssignments) {
      const lastPos = await this.prisma.position.findFirst({
        where: { assignmentId: assignment.id },
        orderBy: { ts: 'desc' }, // Ordena por data decrescente para pegar a última
      });

      if (lastPos) {
        const lastPingTime = lastPos.ts.getTime();
        const diffMinutes = (now - lastPingTime) / 1000 / 60;
        
        // Se o último ping foi há menos de 10 minutos, consideramos ONLINE
        const status = diffMinutes < 10 ? 'online' : 'offline'; 

        results.push({
          driver_id: assignment.driverId,
          name: assignment.driver.user.name,
          plate: assignment.driver.vehicles[0]?.plate || 'N/A',
          campaign_name: assignment.campaign.title,
          status: status,
          last_update: lastPos.ts,
          latitude: lastPos.lat,
          longitude: lastPos.lon,
          speed_kmh: lastPos.speed || 0,
        });
      } else {
        // Motorista ativo mas sem pings (raro, mas possível logo após ativação)
        results.push({
          driver_id: assignment.driverId,
          name: assignment.driver.user.name,
          plate: assignment.driver.vehicles[0]?.plate || 'N/A',
          campaign_name: assignment.campaign.title,
          status: 'offline',
          last_update: null,
          latitude: null,
          longitude: null,
          speed_kmh: 0,
        });
      }
    }

    return results;
  }
}
