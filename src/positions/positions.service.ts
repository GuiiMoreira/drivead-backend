import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, AssignmentStatus } from '@prisma/client';
import { PositionDto } from './dto/create-position.dto';

@Injectable()
export class PositionsService {
    constructor(private prisma: PrismaService) { }

    async createPositions(user: User, positionsData: PositionDto[]) {
        // 1. Encontrar o driver associado ao utilizador
        const driver = await this.prisma.driver.findUnique({ where: { userId: user.id } });
        if (!driver) {
            throw new NotFoundException('Perfil de motorista não encontrado.');
        }

        // 2. Encontrar a atribuição (assignment) ativa para este motorista
        const activeAssignment = await this.prisma.assignment.findFirst({
            where: {
                driverId: driver.id,
                status: { in: [AssignmentStatus.installed, AssignmentStatus.active] },
            },
        });

        if (!activeAssignment) {
            // Se não houver campanha ativa, não faz sentido guardar os pontos.
            // Pode-se optar por ignorar silenciosamente ou retornar um erro.
            // Por agora, vamos apenas ignorar.
            console.log(`Nenhuma campanha ativa para o motorista ${driver.id}, posições ignoradas.`);
            return;
        }

        // 3. Prepara os dados para inserção em lote
        const dataToInsert = positionsData.map(p => ({
            driverId: driver.id,
            assignmentId: activeAssignment.id,
            lat: p.lat,
            lon: p.lon,
            speed: p.speed,
            ts: new Date(p.timestamp),
        }));

        // 4. Insere os dados em lote usando `createMany` para alta performance
        const result = await this.prisma.position.createMany({
            data: dataToInsert,
            skipDuplicates: true, // Evita erros se o telemóvel enviar o mesmo ponto duas vezes
        });

        // NOTA: O campo `geom` do PostGIS não é preenchido pelo `createMany`.
        // Isso deve ser feito por um trigger no banco de dados ou um job em background
        // para manter a performance deste endpoint.

        return result;
    }
}