import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentStatus } from '@prisma/client';

@Processor('metrics-queue')
// A classe agora estende WorkerHost, que é uma classe da própria biblioteca bullmq
export class MetricsProcessor extends WorkerHost {
    constructor(private prisma: PrismaService) {
        // É necessário chamar super() no constructor ao estender uma classe
        super();
    }

    // O nome do método agora é obrigatoriamente `process`.
    // Não usamos mais o decorador @Process aqui.
    async process(job: Job<{ assignmentId: string; date: string }>) {
        const { assignmentId, date } = job.data;
        console.log(`Processando métricas para assignment ${assignmentId} na data ${date}`);

        const startDate = new Date(date);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 1);

        const result: any[] = await this.prisma.$queryRaw`
      WITH points AS (
        SELECT
          ts,
          geom,
          LAG(geom) OVER (ORDER BY ts) as prev_geom
        FROM "Position"
        WHERE "assignmentId" = ${assignmentId}::uuid
          AND ts >= ${startDate}
          AND ts < ${endDate}
      )
      SELECT
        SUM(ST_DistanceSphere(prev_geom, geom)) as total_meters
      FROM points
      WHERE prev_geom IS NOT NULL;
    `;

        const kilometersDriven = (result[0]?.total_meters || 0) / 1000;

        await this.prisma.dailyAssignmentMetric.upsert({
            where: {
                assignmentId_date: {
                    assignmentId: assignmentId,
                    date: startDate,
                },
            },
            update: {
                kilometersDriven: kilometersDriven,
            },
            create: {
                assignmentId: assignmentId,
                date: startDate,
                kilometersDriven: kilometersDriven,
            },
        });

        console.log(`Cálculo para ${assignmentId} concluído. KM: ${kilometersDriven.toFixed(2)}`);
    }
}