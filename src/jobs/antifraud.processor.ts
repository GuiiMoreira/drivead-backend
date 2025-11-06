import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';

@Processor('antifraud-queue')
export class AntifraudProcessor extends WorkerHost {
    private readonly logger = new Logger(AntifraudProcessor.name);

    // Definimos o tempo máximo de inatividade (ex: 24 horas em milissegundos)
    private readonly INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

    constructor(private prisma: PrismaService) {
        super();
    }

    async process(job: Job<{ assignmentId: string }>) {
        const { assignmentId } = job.data;

        const assignment = await this.prisma.assignment.findUnique({
            where: { id: assignmentId }
        });

        // Se a campanha já terminou ou foi marcada como fraude, não faz nada
        if (!assignment || (assignment.status !== 'installed' && assignment.status !== 'active')) {
            return;
        }

        // 1. Encontra o último ping de GPS do motorista
        const lastPing = await this.prisma.position.findFirst({
            where: { assignmentId: assignmentId },
            orderBy: { ts: 'desc' }, // Ordena por timestamp decrescente
        });

        const now = new Date();

        if (!lastPing) {
            // Caso 1: O motorista instalou o adesivo mas NUNCA enviou um ping
            // Verificamos se a instalação foi há mais de 24h
            const timeSinceInstalled = now.getTime() - assignment.installedAt!.getTime();
            if (timeSinceInstalled > this.INACTIVITY_THRESHOLD_MS) {
                this.logger.warn(`Fraude (Inatividade): Motorista ${assignment.driverId} nunca enviou pings.`);
                return this.flagAssignment(assignmentId);
            }
        } else {
            // Caso 2: O motorista enviou pings, mas parou
            const timeSinceLastPing = now.getTime() - lastPing.ts.getTime();
            if (timeSinceLastPing > this.INACTIVITY_THRESHOLD_MS) {
                this.logger.warn(`Fraude (Inatividade): Motorista ${assignment.driverId} está inativo há mais de 24h.`);
                return this.flagAssignment(assignmentId);
            }
        }

        this.logger.log(`Verificação de inatividade OK para assignment ${assignmentId}.`);
    }

    /**
     * Marca uma atribuição (assignment) como fraudulenta.
     */
    private async flagAssignment(assignmentId: string) {
        await this.prisma.assignment.update({
            where: { id: assignmentId },
            data: {
                status: AssignmentStatus.fraud,
            },
        });
    }
}