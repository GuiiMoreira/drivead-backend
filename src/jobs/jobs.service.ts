import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignStatus, ProofRequestStatus, AssignmentStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class JobsService {
      private readonly logger = new Logger(JobsService.name);
    constructor(
        @InjectQueue('metrics-queue') private metricsQueue: Queue,
        @InjectQueue('antifraud-queue') private antifraudQueue: Queue,
        private prisma: PrismaService,
        private notificationsService: NotificationsService,
    ) { }

    // Este método roda automaticamente todos os dias às 3 da manhã
    @Cron(CronExpression.EVERY_DAY_AT_3AM)
    async scheduleDailyMetricsCalculation() {
        console.log('Agendando jobs para cálculo de métricas diárias...');

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const activeAssignments = await this.prisma.assignment.findMany({
            where: {
                status: { in: [AssignmentStatus.installed, AssignmentStatus.active] },
            },
            select: {
                id: true,
            },
        });

        for (const assignment of activeAssignments) {
            // Adiciona um job à fila para cada campanha ativa
            await this.metricsQueue.add('calculate-daily-metrics', {
                assignmentId: assignment.id,
                date: yesterday.toISOString().split('T')[0], // Formato YYYY-MM-DD
            });
        }

        console.log(`${activeAssignments.length} jobs de cálculo agendados.`);
    }

    @Cron(CronExpression.EVERY_HOUR)
    async scheduleInactivityChecks() {
        console.log('Agendando jobs para verificação de inatividade...');

        const activeAssignments = await this.prisma.assignment.findMany({
            where: {
                // Apenas motoristas que já instalaram o adesivo
                status: { in: [AssignmentStatus.installed, AssignmentStatus.active] },
            },
            select: {
                id: true,
            },
        });

        for (const assignment of activeAssignments) {
            await this.antifraudQueue.add('check-driver-inactivity', {
                assignmentId: assignment.id,
            });
        }

        console.log(`${activeAssignments.length} jobs de verificação de inatividade agendados.`);
    }
/**
   * Worker Principal de Finalização
   * Roda todo dia à meia-noite.
   * Verifica:
   * 1. Ciclos individuais de motoristas que acabaram.
   * 2. Campanhas com validade global expirada (se houver).
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkCompletions() {
    this.logger.log('🔄 Iniciando verificação de ciclos de campanha...');
    const now = new Date();

    // =================================================================
    // CASO 1: CICLO INDIVIDUAL DO MOTORISTA (30 dias rodados)
    // =================================================================
    
    // Busca todas as atribuições ATIVAS que já foram instaladas
    const activeAssignments = await this.prisma.assignment.findMany({
      where: {
        status: AssignmentStatus.active,
        installedAt: { not: null }, // Tem que ter começado para poder acabar
      },
      include: {
        campaign: {
          select: { durationDays: true, id: true }
        }
      }
    });

    for (const assignment of activeAssignments) {
      if (!assignment.installedAt) continue;

      // Calcula a data final específica deste motorista
      // Data Instalação + Duração da Campanha
      const driverEndDate = new Date(assignment.installedAt);
      driverEndDate.setDate(driverEndDate.getDate() + assignment.campaign.durationDays);

      // Se hoje já passou da data final dele
      if (now >= driverEndDate) {
        this.logger.log(`🏁 Motorista ${assignment.driverId} completou o ciclo na campanha ${assignment.campaignId}.`);

        // Solicita a PROVA FINAL (Status PENDING_FINAL)
        await this.prisma.assignment.update({
          where: { id: assignment.id },
          data: {
            proofStatus: ProofRequestStatus.PENDING_FINAL,
            // Opcional: Pode mudar status principal para 'ending' se quiser travar métricas
          }
        });

        // TODO: Enviar Push Notification: "Parabéns! Você completou os 30 dias. Envie a foto final para receber."
      }
    }

    // =================================================================
    // CASO 3: VALIDADE GLOBAL DA CAMPANHA (Se o anunciante definiu prazo)
    // =================================================================
    
    // Busca campanhas ativas que tenham data de validade (endAt) E que já venceram
    const expiredGlobalCampaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.active,
        endAt: { not: null, lt: now }, // endAt existe E é menor que agora
      },
      include: {
        assignments: { where: { status: 'active' } } // Pega quem ainda está rodando
      }
    });

    for (const campaign of expiredGlobalCampaigns) {
      this.logger.log(`🛑 Campanha ${campaign.id} atingiu a data limite global.`);

      // Encerra a campanha globalmente
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: CampaignStatus.finished }
      });

      // Solicita finalização para TODOS os motoristas ativos nela, 
      // mesmo que não tenham completado os 30 dias (regra de validade impera)
      if (campaign.assignments.length > 0) {
        await this.prisma.assignment.updateMany({
          where: { campaignId: campaign.id, status: 'active' },
          data: { proofStatus: ProofRequestStatus.PENDING_FINAL }
        });
      }
    }
  }

   /**
   * Sorteia motoristas ativos para enviarem uma foto aleatória.
   */
  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async scheduleRandomProofRequests() {
    this.logger.log('Iniciando sorteio de prova aleatória...');

    // 1. Busca todas as atribuições elegíveis
    // Precisamos incluir o 'driver' e 'user' para ter o ID do usuário para notificar
    const eligibleAssignments = await this.prisma.assignment.findMany({
      where: {
        status: { in: [AssignmentStatus.installed, AssignmentStatus.active] },
        proofStatus: ProofRequestStatus.NONE,
      },
      include: {
        driver: {
          include: { user: true }
        }
      }
    });

    const PROBABILITY = 0.1; // 10% chance
    let count = 0;

    for (const assignment of eligibleAssignments) {
      if (Math.random() < PROBABILITY) {
        // A. Marca no banco
        await this.prisma.assignment.update({
          where: { id: assignment.id },
          data: { proofStatus: ProofRequestStatus.PENDING_RANDOM },
        });
        
        // B. Envia Notificação Push + In-App
        const userId = assignment.driver.userId;
        await this.notificationsService.sendNotification(
          userId,
          '📸 Verificação Necessária',
          'Você foi sorteado! Envie uma foto do veículo hoje para continuar na campanha.',
          { 
            type: 'PROOF_REQUEST', 
            assignmentId: assignment.id,
            proofType: 'RANDOM'
          }
        );

        this.logger.log(`📸 Solicitação enviada para motorista ${userId}`);
        count++;
      }
    }

    this.logger.log(`Sorteio finalizado. ${count} motoristas notificados.`);
  }
}