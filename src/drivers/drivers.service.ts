import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { User } from '@prisma/client';

@Injectable()
export class DriversService {
    constructor(private prisma: PrismaService) { }

    /**
     * Cria o perfil de um motorista e o seu veículo inicial.
     * Executa a operação dentro de uma transação para garantir a consistência dos dados.
     * @param user - O objeto de utilizador autenticado (do token JWT).
     * @param createDriverDto - Os dados do perfil e do veículo.
     */
    async createDriverProfile(user: User, createDriverDto: CreateDriverDto) {
        // Garante que apenas utilizadores com a role 'driver' podem criar um perfil de motorista.
        if (user.role !== 'driver') {
            throw new ForbiddenException('Apenas utilizadores do tipo "driver" podem criar um perfil.');
        }

        // Verifica se este utilizador já tem um perfil de motorista
        const existingDriver = await this.prisma.driver.findUnique({
            where: { userId: user.id },
        });

        if (existingDriver) {
            throw new ForbiddenException('Este utilizador já possui um perfil de motorista.');
        }

        const { driver, vehicle } = createDriverDto;

        // A transação garante que, se a criação do veículo falhar,
        // a criação do motorista também será revertida.
        return this.prisma.$transaction(async (tx) => {
            // 1. Atualiza o nome do utilizador principal
            await tx.user.update({
                where: { id: user.id },
                data: { name: driver.name },
            });

            // 2. Cria o perfil do motorista
            const newDriver = await tx.driver.create({
                data: {
                    userId: user.id,
                    cpf: driver.cpf,
                    // Outros campos podem ser definidos aqui ou atualizados depois
                },
            });

            // 3. Cria o veículo e associa-o ao novo motorista
            const newVehicle = await tx.vehicle.create({
                data: {
                    driverId: newDriver.id,
                    plate: vehicle.plate,
                    model: vehicle.model,
                    year: vehicle.year,
                },
            });

            return {
                message: 'Perfil de motorista criado com sucesso.',
                driver: newDriver,
                vehicle: newVehicle,
            };
        });
    }

    /**
  * Salva os URLs dos documentos de KYC no banco de dados.
  * @param user - O utilizador autenticado.
  * @param files - O objeto de ficheiros recebido do Multer.
  */
    async saveKycDocuments(user: User, files: { [fieldname: string]: Express.Multer.File[] }) {
        const driver = await this.prisma.driver.findUnique({
            where: { userId: user.id },
        });

        if (!driver) {
            throw new NotFoundException('Perfil de motorista não encontrado.');
        }

        const documentPromises = Object.keys(files).map(async (key) => {
            const file = files[key][0];
            const docType = key; // ex: 'cnhFront'

            // --- SIMULAÇÃO DE UPLOAD PARA S3 ---
            // Em produção, aqui você chamaria um serviço de storage para fazer o upload
            // e ele retornaria a URL.
            const fileUrl = `https://fake-cdn.drivead.com/uploads/drivers/${driver.id}/${docType}-${Date.now()}-${file.originalname}`;
            console.log(`Simulando upload de ${file.originalname} para ${fileUrl}`);
            // --- FIM DA SIMULAÇÃO ---

            return this.prisma.kycDocument.create({
                data: {
                    driverId: driver.id,
                    docType: docType,
                    fileUrl: fileUrl,
                    status: 'pending', // O status inicial é sempre pendente de aprovação
                },
            });
        });

        await Promise.all(documentPromises);
    }
}