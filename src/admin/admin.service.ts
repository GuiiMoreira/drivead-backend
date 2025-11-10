import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KycStatus, TransactionStatus, AssignmentStatus, ProofRequestStatus } from '@prisma/client';

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
}