import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { CampaignStatus, User, AssignmentStatus } from '@prisma/client';
import { ScheduleInstallDto } from './dto/schedule-install.dto';
import { VehicleCategory } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { ProofType } from '@prisma/client';
import { WithdrawRequestDto } from './dto/withdraw-request.dto';
import { TransactionStatus, TransactionType } from '@prisma/client';

@Injectable()
export class DriversService {
    constructor(private prisma: PrismaService,
        private storageService: StorageService,
    ) { }

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

        return this.prisma.$transaction(async (tx) => {

            await tx.user.update({
                where: { id: user.id },
                data: { name: driver.name },
            });

            const newDriver = await tx.driver.create({
                data: {
                    userId: user.id,
                    cpf: driver.cpf,
                },
            });

            // 3. Cria o veículo e associa-o ao novo motorista
            const newVehicle = await tx.vehicle.create({
                data: {
                    driverId: newDriver.id,
                    plate: vehicle.plate,
                    model: vehicle.model,
                    year: vehicle.year,
                    category: vehicle.category ?? VehicleCategory.ESSENTIAL,
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
        const driver = await this.prisma.driver.findUnique({ where: { userId: user.id } });
        if (!driver) { throw new NotFoundException('Perfil de motorista não encontrado.'); }

        const documentPromises = Object.keys(files).map(async (key) => {
            const file = files[key][0];

            const fileUrl = await this.storageService.uploadFile(file, `drivers/${driver.id}/kyc`);

            return this.prisma.kycDocument.create({
                data: {
                    driverId: driver.id,
                    docType: key,
                    fileUrl: fileUrl,
                    status: 'pending',
                },
            });
        });
        await Promise.all(documentPromises);
    }

    async listEligibleCampaigns(user: User) {
        // --- NOVO: Buscamos também o veículo para saber a sua categoria ---
        const driver = await this.prisma.driver.findUnique({
            where: { userId: user.id },
            include: {
                vehicles: {
                    take: 1, // Assumimos o primeiro veículo registado para o MVP
                },
            },
        });

        // --- NOVO: Verificamos também se o motorista tem um veículo ---
        if (!driver || driver.kycStatus !== 'approved' || driver.vehicles.length === 0) {
            throw new ForbiddenException('O seu perfil de motorista não está aprovado ou não tem um veículo registado.');
        }

        const driverVehicle = driver.vehicles[0];

        // --- NOVO: Definimos a hierarquia de categorias para a lógica de filtro ---
        const categoryRank = {
            ESSENTIAL: 1,
            SMART: 2,
            PRO: 2,
            PRIME: 3,
            ECO: 3,
        };
        const driverRank = categoryRank[driverVehicle.category];
        // --------------------------------------------------------------------

        const whereConditions: any[] = [{ status: CampaignStatus.active }];
        if (!driver.optInPolitical) {
            whereConditions.push({ type: { not: 'political' } });
        }

        const campaigns = await this.prisma.campaign.findMany({
            where: {
                AND: whereConditions,
            },
            include: {
                _count: {
                    select: {
                        assignments: {
                            where: {
                                status: {
                                    notIn: [AssignmentStatus.rejected, AssignmentStatus.removed, AssignmentStatus.finished, AssignmentStatus.fraud],
                                },
                            },
                        },
                    },
                },
            },
        });

        // Filtramos em memória para aplicar ambas as regras: vagas e categoria
        const availableCampaigns = campaigns.filter(campaign => {
            // 1. Verifica se a campanha ainda tem vagas
            const hasVacancy = campaign._count.assignments < campaign.numCars;
            if (!hasVacancy) {
                return false; // Se não tem vaga, já é inelegível
            }

            // --- NOVO: 2. Verifica se o carro cumpre o requisito de categoria ---
            const requirements = campaign.requirements as any;
            if (!requirements || !requirements.targetCategory) {
                return true; // Se a campanha não exige categoria, o carro é elegível
            }

            const campaignRank = categoryRank[requirements.targetCategory];

            // O motorista é elegível se a sua categoria for igual ou superior à exigida
            const isEligibleByCategory = driverRank >= campaignRank;

            return isEligibleByCategory;
            // --------------------------------------------------------------------
        });

        // Removemos o campo _count da resposta final para limpar o output
        return availableCampaigns.map(({ _count, ...campaign }) => campaign);
    }

    /**
     * Permite que um motorista se candidate a uma campanha, criando um 'assignment'.
     */
    async applyForCampaign(user: User, campaignId: string) {
        const driver = await this.prisma.driver.findUnique({
            where: { userId: user.id },
            include: { vehicles: true },
        });

        if (!driver || driver.kycStatus !== 'approved') {
            throw new ForbiddenException('O seu perfil de motorista não está aprovado para participar em campanhas.');
        }





        const activeAssignment = await this.prisma.assignment.findFirst({
            where: {
                driverId: driver.id,
                status: {
                    in: [
                        AssignmentStatus.assigned,
                        AssignmentStatus.accepted,
                        AssignmentStatus.installed,
                        AssignmentStatus.active
                    ]
                }
            }
        });

        if (activeAssignment) {
            throw new ConflictException('Você já está participando de uma campanha. Finalize a campanha atual antes de se candidatar a uma nova.');
        }

        const campaign = await this.prisma.campaign.findUnique({
            where: { id: campaignId },
        });

        const pricePerCar = campaign!.budget / campaign!.numCars;
        const driverPayoutAmount = pricePerCar * 0.40; // 40% para o motorista

        if (!campaign || campaign.status !== 'active') {
            throw new NotFoundException('Campanha não encontrada ou não está ativa.');
        }

        const assignmentCount = await this.prisma.assignment.count({
            where: {
                campaignId: campaignId,
                status: {
                    notIn: [AssignmentStatus.rejected, AssignmentStatus.removed, AssignmentStatus.finished, AssignmentStatus.fraud]
                }
            }
        });

        if (assignmentCount >= campaign.numCars) {
            throw new ConflictException('Esta campanha já atingiu o número máximo de participantes.');
        }

        const existingAssignment = await this.prisma.assignment.findFirst({
            where: { driverId: driver.id, campaignId: campaignId },
        });

        if (existingAssignment) {
            throw new ConflictException('Você já se candidatou a esta campanha.');
        }

        const vehicle = driver.vehicles[0];
        if (!vehicle) {
            throw new NotFoundException('Nenhum veículo registado para este motorista.');
        }

        return this.prisma.assignment.create({
            data: {
                driverId: driver.id,
                campaignId: campaignId,
                vehicleId: vehicle.id,
                status: AssignmentStatus.assigned,
                payoutAmount: parseFloat(driverPayoutAmount.toFixed(2)),
            },
        });
    }

    /**
  * Obtém a atribuição (assignment) ativa do motorista.
  */
    async getCurrentAssignment(user: User) {
        const assignment = await this.prisma.assignment.findFirst({
            where: {
                driver: { userId: user.id },
                status: AssignmentStatus.assigned,
            },
            include: {
                campaign: true, // Inclui detalhes da campanha
            },
        });

        if (!assignment) {
            throw new NotFoundException('Nenhuma campanha pendente de agendamento encontrada.');
        }
        return assignment;
    }

    /**
     * Agenda a instalação para a atribuição ativa do motorista.
     */
    async scheduleInstallation(user: User, scheduleDto: ScheduleInstallDto) {
        const assignment = await this.getCurrentAssignment(user); // Reutiliza o método para encontrar a atribuição

        return this.prisma.assignment.update({
            where: { id: assignment.id },
            data: {
                installerId: scheduleDto.installerId,
                scheduledInstallAt: new Date(scheduleDto.scheduledAt),
                status: AssignmentStatus.accepted, // Muda o status para indicar que o agendamento foi aceite
            },
        });
    }

    /**
  * Confirma a instalação de uma campanha, recebendo as fotos de antes e depois.
  * Cria o registo de prova e atualiza o status da atribuição para 'installed'.
  */
    async confirmInstallation(user: User, files: { photoBefore?: Express.Multer.File[], photoAfter?: Express.Multer.File[] }) {
        if (!files.photoBefore || !files.photoAfter) {
            throw new BadRequestException('As fotos de antes e depois são obrigatórias.');
        }

        // 1. Encontra a atribuição que está pendente de instalação (status 'accepted')
        const assignment = await this.prisma.assignment.findFirst({
            where: {
                driver: { userId: user.id },
                status: AssignmentStatus.accepted,
            }
        });

        if (!assignment) {
            throw new NotFoundException('Nenhuma instalação agendada encontrada para confirmar.');
        }

        const photoBefore = files.photoBefore[0];
        const photoAfter = files.photoAfter[0];

        // 2. Simula o upload dos ficheiros para o storage
        const photoBeforeUrl = await this.storageService.uploadFile(files.photoBefore[0], `proofs/${assignment.id}`);
        const photoAfterUrl = await this.storageService.uploadFile(files.photoAfter[0], `proofs/${assignment.id}`);

        console.log(`Simulando upload de ${photoBefore.originalname} para ${photoBeforeUrl}`);
        console.log(`Simulando upload de ${photoAfter.originalname} para ${photoAfterUrl}`);

        // 3. Executa a criação da prova e a atualização da atribuição numa transação
        return this.prisma.$transaction(async (tx) => {
            // Cria o registo de prova de instalação
            await tx.installProof.create({
                data: {
                    assignmentId: assignment.id,
                    photoBeforeUrl: photoBeforeUrl,
                    photoAfterUrl: photoAfterUrl,
                    installerId: assignment.installerId,
                }
            });

            // Atualiza a atribuição para o status 'installed'
            const updatedAssignment = await tx.assignment.update({
                where: { id: assignment.id },
                data: {
                    status: AssignmentStatus.installed,
                    installedAt: new Date(),
                }
            });

            return updatedAssignment;
        });
    }

    async getMyWallet(user: User) {
        const wallet = await this.prisma.driverWallet.findFirst({
            where: {
                driver: { userId: user.id },
            },
            include: {
                transactions: {
                    orderBy: {
                        createdAt: 'desc', // Mostra as transações mais recentes primeiro
                    },
                },
            },
        });

        if (!wallet) {
            // Se o motorista nunca recebeu, ele pode não ter uma carteira ainda
            return { balance: 0, transactions: [] };
        }

        return wallet;
    }

    /**
   * Recebe uma foto de prova periódica (aleatória ou final) do motorista.
   */
    async submitPeriodicProof(user: User, file: Express.Multer.File, proofType: ProofType) {
        // 1. Encontra a atribuição ativa do motorista
        const assignment = await this.prisma.assignment.findFirst({
            where: {
                driver: { userId: user.id },
                status: { in: [AssignmentStatus.installed, AssignmentStatus.active] },
            },
        });

        if (!assignment) {
            throw new NotFoundException('Nenhuma campanha ativa encontrada para enviar a prova.');
        }

        // 2. Faz o upload do ficheiro para o Cloudflare R2
        const fileUrl = await this.storageService.uploadFile(
            file,
            `proofs/${assignment.id}/periodic`, // Guarda numa subpasta 'periodic'
        );

        // 3. Guarda o registo da prova no banco de dados
        const newProof = await this.prisma.periodicProof.create({
            data: {
                assignmentId: assignment.id,
                photoUrl: fileUrl,
                proofType: proofType,
            },
        });

        return newProof;
    }

    async requestWithdrawal(user: User, withdrawDto: WithdrawRequestDto) {
        const { amount } = withdrawDto;

        // 1. Encontra a carteira do motorista
        const wallet = await this.prisma.driverWallet.findFirst({
            where: {
                driver: { userId: user.id },
            },
        });

        if (!wallet || wallet.balance < amount) {
            throw new ForbiddenException('Saldo insuficiente para realizar o saque.');
        }

        // 2. Executa o saque numa transação
        return this.prisma.$transaction(async (tx) => {
            // 2.1. Subtrai o valor do saldo da carteira
            const updatedWallet = await tx.driverWallet.update({
                where: { id: wallet.id },
                data: {
                    balance: {
                        decrement: amount,
                    },
                },
            });

            // 2.2. Cria o registo da transação de débito (saque)
            const transaction = await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    amount: -amount, // Guardamos o valor como negativo para débitos
                    type: TransactionType.DEBIT,
                    status: TransactionStatus.PENDING, // O saque fica pendente de aprovação/processamento do admin
                    description: `Solicitação de saque via PIX`,
                },
            });

            // TODO: Disparar notificação para o admin sobre o novo pedido de saque

            return {
                message: 'Solicitação de saque recebida com sucesso. O processamento será feito pela nossa equipa.',
                newBalance: updatedWallet.balance,
                transaction,
            };
        });
    }
}