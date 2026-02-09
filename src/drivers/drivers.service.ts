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

  // --- NOVOS MÉTODOS PARA "DRIVER EXPERIENCE" (Passo 2) ---

  /**
   * Retorna o status consolidado do motorista para a Home do App.
   * Evita múltiplas chamadas (Wallet, Assignment, Profile).
   */
  async getDriverStatus(user: User) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId: user.id },
      include: { 
        wallet: true 
      }
    });

    // Se não tem perfil, retorna estado inicial
    if (!driver) {
      return {
        status: 'onboarding_incomplete',
        kycStatus: 'none',
        walletBalance: 0,
        activeAssignment: null,
        nextAction: 'Complete seu cadastro para começar',
        notificationsCount: 0 // Placeholder por enquanto
      };
    }

    // Busca assignment ativo (se houver)
    const activeAssignment = await this.getCurrentAssignment(user);
    
    // Define a "Próxima Ação" baseada no estado atual
    let nextAction = 'Aguardando oportunidades';
    if (activeAssignment) {
       switch (activeAssignment.status) {
          case AssignmentStatus.accepted: nextAction = 'Agendar Instalação do Adesivo'; break;
          case AssignmentStatus.scheduled: nextAction = 'Ir ao local de instalação'; break;
          case AssignmentStatus.installed: nextAction = 'Aguardando ativação'; break;
          case AssignmentStatus.active: nextAction = 'Campanha ativa: Mantenha o GPS ligado'; break;
          case AssignmentStatus.awaiting_approval: nextAction = 'Aguardando validação da instalação'; break;
       }
    } else if (driver.kycStatus === 'pending') {
       nextAction = 'Aguardando aprovação de documentos';
    } else if (driver.kycStatus === 'rejected') {
       nextAction = 'Corrigir documentos rejeitados';
    } else if (driver.kycStatus === 'approved') {
       nextAction = 'Escolher uma campanha';
    }

    return {
      status: 'active', // Perfil existe
      kycStatus: driver.kycStatus,
      walletBalance: driver.wallet?.balance || 0,
      activeAssignment: activeAssignment, // Retorna objeto completo ou null
      nextAction,
      notificationsCount: 0 
    };
  }

  /**
   * Retorna o progresso detalhado do cadastro (Onboarding).
   * O App usa isso para saber qual tela mostrar (Upload CNH, Fotos Carro, etc).
   */
  async getOnboardingStatus(user: User) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId: user.id },
      include: { 
        vehicles: true,
        kycDocuments: true 
      }
    });

    // Passo 1: Perfil Básico
    if (!driver) {
      return { step: 'profile_creation', missing: ['profile'], isApproved: false };
    }

    // Passo 2: Veículo
    if (driver.vehicles.length === 0) {
      return { step: 'vehicle_registration', missing: ['vehicle'], isApproved: false };
    }

    const vehicle = driver.vehicles[0];
    const vehiclePhotos = vehicle.photos as any || {};
    
    // Passo 3: Fotos do Veículo
    const missingPhotos = [];
    if (!vehiclePhotos.front) missingPhotos.push('front');
    if (!vehiclePhotos.side) missingPhotos.push('side');
    if (!vehiclePhotos.rear) missingPhotos.push('rear');

    if (missingPhotos.length > 0) {
       return { step: 'vehicle_photos', missing: missingPhotos, isApproved: false };
    }

    // Passo 4: Documentos (KYC)
    const requiredDocs = ['cnhFront', 'cnhBack', 'crlv', 'selfie'];
    const uploadedDocs = driver.kycDocuments.map(d => d.docType);
    const missingDocs = requiredDocs.filter(doc => !uploadedDocs.includes(doc));

    if (missingDocs.length > 0) {
      return { step: 'documents_upload', missing: missingDocs, isApproved: false };
    }

    // Passo 5: Revisão / Status Final
    if (driver.kycStatus === 'pending') {
      return { step: 'under_review', missing: [], isApproved: false, message: 'Seus documentos estão em análise.' };
    }

    if (driver.kycStatus === 'rejected') {
      // CORREÇÃO: Removemos driver.rejectionReason pois não existe no schema
      return { step: 'rejected', missing: [], isApproved: false, rejectionReason: 'Documentação reprovada. Verifique os detalhes.' };
    }

    // Tudo ok
    return { step: 'completed', missing: [], isApproved: true };
  }

  // -----------------------------------------------------------

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

  async quitCampaign(user: User, reason: string) {
    const assignment = await this.getCurrentAssignment(user);
    
    if (!assignment) {
      throw new NotFoundException('Você não possui nenhuma campanha ativa para sair.');
    }

    // Atualiza o status para indicar que a remoção foi solicitada
    return this.prisma.assignment.update({
      where: { id: assignment.id },
      data: {
        status: AssignmentStatus.removal_requested, // Certifique-se que este status existe no seu Enum
        // Se quiser salvar o motivo, pode adicionar um campo 'notes' ou 'metadata' na Assignment
        // ou criar um registro de AuditLog
      }
    });
  }
 /**
   * Obtém o histórico de campanhas passadas do motorista (finalizadas ou removidas).
   */
  async getCampaignHistory(user: User) {
    const history = await this.prisma.assignment.findMany({
      where: {
        driver: { userId: user.id },
        status: {
          in: [AssignmentStatus.finished, AssignmentStatus.removed]
        }
      },
      include: {
        campaign: true, // Inclui detalhes da campanha para mostrar título, datas, etc.
        // Opcional: incluir métricas finais se quiser mostrar resumo de KM rodado
        // dailyMetrics: { select: { kilometersDriven: true } } 
      },
      orderBy: {
        updatedAt: 'desc' // As mais recentes primeiro
      }
    });

    return history;
  }

  async saveVehiclePhotos(user: User, files: { front?: Express.Multer.File[], side?: Express.Multer.File[], rear?: Express.Multer.File[] }) {
    // 1. Encontra o veículo principal do motorista
    // (Assumimos o primeiro veículo ou o mais recente. No futuro pode ser por ID do veículo)
    const driver = await this.prisma.driver.findUnique({
      where: { userId: user.id },
      include: {
        vehicles: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!driver || driver.vehicles.length === 0) {
      throw new NotFoundException('Nenhum veículo encontrado para este motorista.');
    }

    const vehicle = driver.vehicles[0];

    // 2. Faz o upload das 3 imagens em paralelo
    const [frontUrl, sideUrl, rearUrl] = await Promise.all([
      files.front ? this.storageService.uploadFile(files.front[0], `vehicles/${vehicle.id}/front`) : Promise.resolve(null),
      files.side ? this.storageService.uploadFile(files.side[0], `vehicles/${vehicle.id}/side`) : Promise.resolve(null),
      files.rear ? this.storageService.uploadFile(files.rear[0], `vehicles/${vehicle.id}/rear`) : Promise.resolve(null),
    ]);

    // 3. Atualiza o registo do veículo com as URLs no campo JSON 'photos'
    const updatedVehicle = await this.prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        photos: {
          front: frontUrl,
          side: sideUrl,
          rear: rearUrl,
          updatedAt: new Date().toISOString()
        }
      }
    });

    return updatedVehicle;
  }
}