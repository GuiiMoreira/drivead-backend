import { Injectable, NotFoundException } from '@nestjs/common';
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
}