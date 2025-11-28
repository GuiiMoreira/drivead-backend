import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { CampaignStatus, User, AssignmentStatus, ApprovalStatus, VehicleCategory, ProofType, TransactionStatus, TransactionType, ProofRequestStatus } from '@prisma/client';
import { ScheduleInstallDto } from './dto/schedule-install.dto';
import { StorageService } from '../storage/storage.service';
import { WithdrawRequestDto } from './dto/withdraw-request.dto';

@Injectable()
export class DriversService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) { }

  async createDriverProfile(user: User, createDriverDto: CreateDriverDto) {
    if (user.role !== 'driver') {
      throw new ForbiddenException('Apenas utilizadores do tipo "driver" podem criar um perfil.');
    }

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
    const driver = await this.prisma.driver.findUnique({
      where: { userId: user.id },
      include: {
        vehicles: { take: 1 },
      },
    });

    if (!driver || driver.kycStatus !== 'approved' || driver.vehicles.length === 0) {
      throw new ForbiddenException('O seu perfil de motorista não está aprovado ou não tem um veículo registado.');
    }

    const driverVehicle = driver.vehicles[0];

    const categoryRank = {
      ESSENTIAL: 1,
      SMART: 2,
      PRO: 2,
      PRIME: 3,
      ECO: 3,
    };
    const driverRank = categoryRank[driverVehicle.category];

    const whereConditions: any[] = [{ status: CampaignStatus.active }];
    if (!driver.optInPolitical) {
      whereConditions.push({ type: { not: 'political' } });
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: { AND: whereConditions },
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

    const availableCampaigns = campaigns.filter(campaign => {
      const hasVacancy = campaign._count.assignments < campaign.numCars;
      if (!hasVacancy) return false;

      const requirements = campaign.requirements as any;
      if (!requirements || !requirements.targetCategory) return true;

      const campaignRank = categoryRank[requirements.targetCategory];
      return driverRank >= campaignRank;
    });

    return availableCampaigns.map(({ _count, ...campaign }) => campaign);
  }

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
            AssignmentStatus.scheduled,
            AssignmentStatus.awaiting_approval,
            AssignmentStatus.installed,
            AssignmentStatus.active
          ]
        }
      }
    });

    if (activeAssignment) {
      throw new ConflictException('Você já está participando de uma campanha.');
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign || campaign.status !== 'active') {
      throw new NotFoundException('Campanha não encontrada ou não está ativa.');
    }

    const pricePerCar = campaign.budget / campaign.numCars;
    const driverPayoutAmount = pricePerCar * 0.40;

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

    const vehicle = driver.vehicles[0];
    if (!vehicle) {
      throw new NotFoundException('Nenhum veículo registado para este motorista.');
    }

    return this.prisma.assignment.create({
      data: {
        driverId: driver.id,
        campaignId: campaignId,
        vehicleId: vehicle.id,
        status: AssignmentStatus.accepted,
        payoutAmount: parseFloat(driverPayoutAmount.toFixed(2)),
      },
    });
  }

  async getCurrentAssignment(user: User) {
    const assignment = await this.prisma.assignment.findFirst({
      where: {
        driver: { userId: user.id },
        status: {
          in: [
            AssignmentStatus.assigned,
            AssignmentStatus.accepted,
            AssignmentStatus.scheduled, // <--- ADICIONADO
            AssignmentStatus.awaiting_approval,
            AssignmentStatus.installed,
            AssignmentStatus.active
          ]
        },
      },
      include: {
        campaign: true,
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    if (!assignment) {
      // Mudança: Em vez de erro, retorna null (o frontend lida melhor)
      return null; 
    }
    return assignment;
  }

  async scheduleInstallation(user: User, scheduleDto: ScheduleInstallDto) {
    const assignment = await this.getCurrentAssignment(user);
    
    if (!assignment) throw new NotFoundException('Nenhuma campanha pendente.');

    return this.prisma.assignment.update({
      where: { id: assignment.id },
      data: {
        installerId: scheduleDto.installerId,
        scheduledInstallAt: new Date(scheduleDto.scheduledAt),
        status: AssignmentStatus.scheduled,
      },
    });
  }

  async confirmInstallation(user: User, files: { photoBefore?: Express.Multer.File[], photoAfter?: Express.Multer.File[] }) {
    if (!files.photoBefore || !files.photoAfter) {
      throw new BadRequestException('As fotos de antes e depois são obrigatórias.');
    }

    const assignment = await this.prisma.assignment.findFirst({
      where: {
        driver: { userId: user.id },
        status: AssignmentStatus.scheduled,
      }
    });

    if (!assignment) {
      throw new NotFoundException('Nenhuma instalação agendada encontrada para confirmar.');
    }

    const [photoBeforeUrl, photoAfterUrl] = await Promise.all([
      this.storageService.uploadFile(files.photoBefore[0], `proofs/${assignment.id}/before`),
      this.storageService.uploadFile(files.photoAfter[0], `proofs/${assignment.id}/after`),
    ]);

    return this.prisma.$transaction(async (tx) => {
      await tx.installProof.create({
        data: {
          assignmentId: assignment.id,
          photoBeforeUrl: photoBeforeUrl,
          photoAfterUrl: photoAfterUrl,
          installerId: assignment.installerId,
          status: ApprovalStatus.PENDING,
        }
      });

      const updatedAssignment = await tx.assignment.update({
        where: { id: assignment.id },
        data: {
          status: AssignmentStatus.awaiting_approval,
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
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!wallet) {
      return { balance: 0, transactions: [] };
    }

    return wallet;
  }

  async submitPeriodicProof(user: User, file: Express.Multer.File, proofType: ProofType) {
    const assignment = await this.prisma.assignment.findFirst({
      where: {
        driver: { userId: user.id },
        status: { in: [AssignmentStatus.installed, AssignmentStatus.active] },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Nenhuma campanha ativa encontrada para enviar a prova.');
    }

    const fileUrl = await this.storageService.uploadFile(
      file,
      `proofs/${assignment.id}/periodic`,
    );

    return this.prisma.$transaction(async (tx) => {
      const newProof = await tx.periodicProof.create({
        data: {
          assignmentId: assignment.id,
          photoUrl: fileUrl,
          proofType: proofType,
          status: ApprovalStatus.PENDING
        },
      });

      // CORREÇÃO: Se for prova aleatória, dar baixa na solicitação pendente
      if (proofType === ProofType.RANDOM) {
        await tx.assignment.update({
          where: { id: assignment.id },
          data: { proofStatus: ProofRequestStatus.NONE }
        });
      }

      return newProof;
    });
  }

  async requestWithdrawal(user: User, withdrawDto: WithdrawRequestDto) {
    const { amount } = withdrawDto;

    const wallet = await this.prisma.driverWallet.findFirst({
      where: {
        driver: { userId: user.id },
      },
    });

    if (!wallet || wallet.balance < amount) {
      throw new ForbiddenException('Saldo insuficiente para realizar o saque.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.driverWallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: amount },
        },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: -amount,
          type: TransactionType.DEBIT,
          status: TransactionStatus.PENDING,
          description: `Solicitação de saque via PIX`,
        },
      });

      return {
        message: 'Solicitação de saque recebida com sucesso.',
        newBalance: updatedWallet.balance,
        transaction,
      };
    });
  }

  async getMyVehicles(user: User) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId: user.id },
      include: {
        vehicles: true,
      },
    });

    if (!driver) {
      throw new NotFoundException('Perfil de motorista não encontrado.');
    }

    return driver.vehicles;
  }
}