import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, AssignmentStatus } from '@prisma/client';
import { PositionDto } from './dto/create-position.dto';

@Injectable()
export class PositionsService {
  private readonly logger = new Logger(PositionsService.name);
  private readonly MAX_SPEED_KMH = 300; // Limite de velocidade para detecção de fraude

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
      console.log(`Nenhuma campanha ativa para o motorista ${driver.id}, posições ignoradas.`);
      return;
    }

    // --- NOVA LÓGICA DE ANTIFRAUDE (GPS SPOOFING) ---
    // Busca a última posição conhecida para comparar velocidade
    const lastPosition = await this.prisma.position.findFirst({
      where: { driverId: driver.id },
      orderBy: { ts: 'desc' },
    });

    const validPositions = [];
    let previousPoint = lastPosition;

    for (const p of positionsData) {
      const currentLat = p.lat;
      const currentLon = p.lon;
      const currentTs = new Date(p.timestamp);

      // Validação Básica de Coordenadas
      if (currentLat < -90 || currentLat > 90 || currentLon < -180 || currentLon > 180) {
        continue;
      }

      // Validação de Velocidade (Anti-Spoofing)
      if (previousPoint) {
        const lastLat = previousPoint.lat;
        const lastLon = previousPoint.lon;
        const lastTs = previousPoint.ts.getTime();
        const nowTs = currentTs.getTime();

        const timeDiffHours = (nowTs - lastTs) / 1000 / 3600;

        // Se a diferença de tempo for muito pequena (ex: ms), ignoramos o cálculo para evitar divisão por zero
        // 0.0002 horas ~= 0.7 segundos
        if (timeDiffHours > 0.0002) {
          const distanceKm = this.calculateHaversineDistance(lastLat, lastLon, currentLat, currentLon);
          const speedKmh = distanceKm / timeDiffHours;

          if (speedKmh > this.MAX_SPEED_KMH) {
            this.logger.warn(`🚨 FRAUDE DETECTADA (GPS Spoofing): Motorista ${driver.id} moveu-se a ${speedKmh.toFixed(0)}km/h.`);

            // AÇÃO: Marcar assignment como FRAUDE
            await this.prisma.assignment.update({
              where: { id: activeAssignment.id },
              data: { status: AssignmentStatus.fraud }
            });

            // Interrompe o processamento imediatamente
            return { message: 'Atividade suspeita detectada. Dados rejeitados.' };
          }
        }
      }

      // Adiciona à lista de inserção
      validPositions.push({
        driverId: driver.id,
        assignmentId: activeAssignment.id,
        lat: currentLat,
        lon: currentLon,
        speed: p.speed,
        ts: currentTs,
      });

      // Atualiza o ponto anterior para a próxima iteração do loop
      previousPoint = { lat: currentLat, lon: currentLon, ts: currentTs } as any;
    }

    // 4. Insere os dados em lote usando `createMany` para alta performance
    if (validPositions.length > 0) {
      const result = await this.prisma.position.createMany({
        data: validPositions,
        skipDuplicates: true, // Evita erros se o telemóvel enviar o mesmo ponto duas vezes
      });
      return result;
    }
  }

  // Fórmula matemática para calcular distância entre dois pontos no globo
  private calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Raio da Terra em km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}