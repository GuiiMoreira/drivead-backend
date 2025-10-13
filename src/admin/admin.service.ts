import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KycStatus } from '@prisma/client';

@Injectable()
export class AdminService {
    constructor(private prisma: PrismaService) { }

    /**
     * Lista todos os motoristas cujo status de KYC é 'pending'.
     */
    async listPendingDrivers() {
        return this.prisma.driver.findMany({
            where: {
                kycStatus: KycStatus.pending,
            },
            include: {
                // Incluímos dados relacionados para dar mais contexto ao admin
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
     * @param driverId - O ID do perfil do motorista a ser aprovado.
     */
    async approveDriver(driverId: string) {
        // Primeiro, verifica se o motorista existe
        const driver = await this.prisma.driver.findUnique({
            where: { id: driverId },
        });

        if (!driver) {
            throw new NotFoundException(`Perfil de motorista com ID "${driverId}" não encontrado.`);
        }

        // Atualiza o status
        const updatedDriver = await this.prisma.driver.update({
            where: { id: driverId },
            data: {
                kycStatus: KycStatus.approved,
            },
        });

        // TODO: Disparar uma notificação para o motorista informando sobre a aprovação.

        return updatedDriver;
    }

    async processAssignmentPayout(assignmentId: string) {
        const assignment = await this.prisma.assignment.findUnique({
            where: { id: assignmentId },
            include: { campaign: true, driver: true },
        });

        if (!assignment) {
            throw new NotFoundException('Atribuição não encontrada.');
        }
        if (assignment.payoutProcessedAt) {
            throw new ConflictException('O pagamento para esta atribuição já foi processado.');
        }
        // Adicionar mais regras, ex: status deve ser 'finished'

        const driverId = assignment.driverId;
        const payoutAmount = assignment.payoutAmount;

        if (!payoutAmount || payoutAmount <= 0) {
            throw new ForbiddenException('O valor de pagamento para esta atribuição é inválido.');
        }

        // Usamos uma transação para garantir que o saldo e o log sejam atualizados atomicamente
        return this.prisma.$transaction(async (tx) => {
            // 1. Cria ou encontra a carteira do motorista
            const wallet = await tx.driverWallet.upsert({
                where: { driverId },
                update: {
                    balance: {
                        increment: payoutAmount, // Adiciona o valor ao saldo
                    },
                },
                create: {
                    driverId,
                    balance: payoutAmount,
                },
            });

            // 2. Cria um registo da transação
            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    amount: payoutAmount,
                    type: 'CREDIT',
                    description: `Pagamento da campanha: ${assignment.campaign.title}`,
                },
            });

            // 3. Marca a atribuição como paga
            const updatedAssignment = await tx.assignment.update({
                where: { id: assignmentId },
                data: {
                    payoutProcessedAt: new Date(),
                },
            });

            // TODO: No futuro, adicionar bónus com base na quilometragem calculada
            // const bonus = calculatePerformanceBonus(assignment.id);
            // await tx.driverWallet.update({ where: { driverId }, data: { balance: { increment: bonus } } });

            return updatedAssignment;
        });
    }
}