import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentStatus } from '@prisma/client';

@Injectable()
export class JobsService {
    constructor(
        @InjectQueue('metrics-queue') private metricsQueue: Queue,
        @InjectQueue('antifraud-queue') private antifraudQueue: Queue,
        private prisma: PrismaService,
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
}