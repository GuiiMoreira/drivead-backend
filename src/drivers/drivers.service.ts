import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { CampaignStatus, User, AssignmentStatus, ApprovalStatus, VehicleCategory, ProofType, TransactionStatus, TransactionType, ProofRequestStatus } from '@prisma/client';
import { ScheduleInstallDto } from './dto/schedule-install.dto';
import { StorageService } from '../storage/storage.service';
import { WithdrawRequestDto } from './dto/withdraw-request.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

@Injectable()
export class DriversService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) { }

async createDriverProfile(user: User, dto: any) {
    return this.prisma.$transaction(async (tx) => {
      
      // 1. UPSERT do Motorista (Apenas dados da tabela Driver)
      const upsertedDriver = await tx.driver.upsert({
        where: { userId: user.id },
        update: {
          cpf: dto.driver.cpf,
          optInPolitical: dto.driver.optInPolitical,
        },
        create: {
          userId: user.id,
          cpf: dto.driver.cpf,
          optInPolitical: dto.driver.optInPolitical,
          kycStatus: 'incomplete', // Status inicial
        },
      });

      // 2. Atualiza o NOME e EMAIL na tabela User
      if (dto.driver.name || dto.driver.email) {
        await tx.user.update({
          where: { id: user.id },
          data: { 
            name: dto.driver.name || user.name,
            email: dto.driver.email || user.email,
          },
        });
      }

      // 3. UPSERT do Veículo (Garante que ele tenha o carro atualizado)
      if (dto.vehicle) {
        const existingVehicle = await tx.vehicle.findFirst({
          where: { driverId: upsertedDriver.id },
        });

        if (existingVehicle) {
          await tx.vehicle.update({
            where: { id: existingVehicle.id },
            data: {
              plate: dto.vehicle.plate,
              model: dto.vehicle.model,
              year: dto.vehicle.year,
              category: dto.vehicle.category,
            },
          });
        } else {
          await tx.vehicle.create({
            data: {
              driverId: upsertedDriver.id,
              plate: dto.vehicle.plate,
              model: dto.vehicle.model,
              year: dto.vehicle.year,
              category: dto.vehicle.category,
            },
          });
        }
      }

      return upsertedDriver;
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

    // CORREÇÃO CRÍTICA (MVP): Atualiza o status do motorista para voltar para a fila de análise
    await this.prisma.driver.update({
      where: { id: driver.id },
      data: { kycStatus: 'pending' }
    });
  }

  // --- MÉTODOS DE "DRIVER EXPERIENCE" ---

  async getDriverStatus(user: User) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId: user.id },
      include: { 
        wallet: true 
      }
    });

    if (!driver) {
      return {
        status: 'onboarding_incomplete',
        kycStatus: 'none',
        walletBalance: 0,
        activeAssignment: null,
        nextAction: 'Complete seu cadastro para começar',
        notificationsCount: 0
      };
    }

    const activeAssignment = await this.getCurrentAssignment(user);
    
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
      status: 'active',
      kycStatus: driver.kycStatus,
      walletBalance: driver.wallet?.balance || 0,
      activeAssignment: activeAssignment,
      nextAction,
      notificationsCount: 0 
    };
  }

  async getOnboardingStatus(user: User) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId: user.id },
      include: { 
        vehicles: true,
        kycDocuments: true 
      }
    });

    if (!driver) {
      return { step: 'profile_creation', missing: ['profile'], isApproved: false };
    }

    if (driver.vehicles.length === 0) {
      return { step: 'vehicle_registration', missing: ['vehicle'], isApproved: false };
    }

    const vehicle = driver.vehicles[0];
    const vehiclePhotos = vehicle.photos as any || {};
    
    const missingPhotos = [];
    if (!vehiclePhotos.front) missingPhotos.push('front');
    if (!vehiclePhotos.side) missingPhotos.push('side');
    if (!vehiclePhotos.rear) missingPhotos.push('rear');

    if (missingPhotos.length > 0) {
       return { step: 'vehicle_photos', missing: missingPhotos, isApproved: false };
    }

    const requiredDocs = ['cnhFront', 'cnhBack', 'crlv', 'selfie'];
    const uploadedDocs = driver.kycDocuments.map(d => d.docType);
    const missingDocs = requiredDocs.filter(doc => !uploadedDocs.includes(doc));

    if (missingDocs.length > 0) {
      return { step: 'documents_upload', missing: missingDocs, isApproved: false };
    }

    if (driver.kycStatus === 'pending') {
      return { step: 'under_review', missing: [], isApproved: false, message: 'Seus documentos estão em análise.' };
    }

    if (driver.kycStatus === 'rejected') {
      return { step: 'rejected', missing: [], isApproved: false, rejectionReason: 'Documentação reprovada. Verifique os detalhes.' };
    }

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

    // Removemos o bloqueio de KYC daqui! O motorista sempre pode ver a vitrine.
    if (!driver) {
      return []; // Se nem o perfil base ele criou, retorna vazio.
    }

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

    const categoryRank = {
      ESSENTIAL: 1, SMART: 2, PRO: 2, PRIME: 3, ECO: 3,
    };

    const availableCampaigns = campaigns.filter(campaign => {
      // Regra 1: Tem vaga?
      const hasVacancy = campaign._count.assignments < campaign.numCars;
      if (!hasVacancy) return false;

      // Regra 2: Categoria do Carro
      // Se ele AINDA NÃO TEM carro, mostramos todas as campanhas para gerar desejo!
      if (driver.vehicles.length === 0) return true;

      const driverVehicle = driver.vehicles[0];
      const driverRank = categoryRank[driverVehicle.category];
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

    // 1. Verificações de Status com mensagens acionáveis para o Front-end
    if (!driver) {
      throw new ForbiddenException('Crie o seu perfil de motorista antes de aceitar campanhas.');
    }

    if (driver.kycStatus === 'incomplete') {
      throw new ForbiddenException('Complete o seu cadastro enviando os documentos e fotos do veículo para aceitar esta campanha.');
    }

    if (driver.kycStatus === 'pending') {
      throw new ForbiddenException('Os seus documentos estão em análise. Aguarde a aprovação para aceitar campanhas.');
    }

    if (driver.kycStatus === 'rejected') {
      throw new ForbiddenException('A sua documentação possui pendências. Por favor, acesse o seu perfil, corrija os documentos e tente novamente.');
    }

    if (driver.vehicles.length === 0) {
      throw new ForbiddenException('Você precisa registrar um veículo no seu perfil antes de aceitar uma campanha.');
    }

    // 2. Continua o fluxo normal se estiver 'approved'
    const activeAssignment = await this.prisma.assignment.findFirst({
      where: {
        driverId: driver.id,
        status: {
          in: [
            AssignmentStatus.assigned, AssignmentStatus.accepted, AssignmentStatus.scheduled,
            AssignmentStatus.awaiting_approval, AssignmentStatus.installed, AssignmentStatus.active
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
            AssignmentStatus.scheduled,
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

    return this.prisma.assignment.update({
      where: { id: assignment.id },
      data: {
        status: AssignmentStatus.removal_requested, 
      }
    });
  }

  async getCampaignHistory(user: User) {
    const history = await this.prisma.assignment.findMany({
      where: {
        driver: { userId: user.id },
        status: {
          in: [AssignmentStatus.finished, AssignmentStatus.removed]
        }
      },
      include: {
        campaign: true, 
      },
      orderBy: {
        updatedAt: 'desc' 
      }
    });

    return history;
  }

  async saveVehiclePhotos(user: User, files: { front?: Express.Multer.File[], side?: Express.Multer.File[], rear?: Express.Multer.File[] }) {
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

    const [frontUrl, sideUrl, rearUrl] = await Promise.all([
      files.front ? this.storageService.uploadFile(files.front[0], `vehicles/${vehicle.id}/front`) : Promise.resolve(null),
      files.side ? this.storageService.uploadFile(files.side[0], `vehicles/${vehicle.id}/side`) : Promise.resolve(null),
      files.rear ? this.storageService.uploadFile(files.rear[0], `vehicles/${vehicle.id}/rear`) : Promise.resolve(null),
    ]);

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

  async updateDriverProfile(user: User, dto: UpdateDriverDto) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId: user.id },
    });

    if (!driver) {
      throw new NotFoundException('Perfil de motorista não encontrado.');
    }

    // O Prisma automaticamente ignora os campos que forem 'undefined' no DTO,
    // atualizando apenas os valores que foram realmente enviados.
    const updatedDriver = await this.prisma.driver.update({
      where: { id: driver.id },
      data: {
        pixKeyType: dto.pixKeyType,
        pixKey: dto.pixKey,
        optInPolitical: dto.optInPolitical,
      },
      select: {
        pixKeyType: true,
        pixKey: true,
        optInPolitical: true,
      }
    });

    return updatedDriver;
  }

   async deleteMyAccount(user: User) {
    // 1. Trava de Segurança: Verificar se há campanha ativa
    const activeAssignment = await this.getCurrentAssignment(user);
    if (activeAssignment) {
        throw new BadRequestException('Você possui uma campanha em andamento. Solicite a saída da campanha e a remoção do adesivo antes de excluir sua conta.');
    }

    // 2. Trava de Segurança: Verificar saldo na carteira
    const wallet = await this.getMyWallet(user);
    if (wallet && wallet.balance > 0) {
        throw new BadRequestException(`Você possui um saldo de R$ ${wallet.balance.toFixed(2)} na sua carteira. Solicite o saque do valor antes de excluir sua conta.`);
    }

    return this.prisma.$transaction(async (tx) => {
      // 3. Desloga o usuário de todos os dispositivos
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() }
      });

      // 4. Marca o KYC como rejeitado para tirar ele de listagens ativas do Admin
      const driver = await tx.driver.findUnique({ where: { userId: user.id } });
      if (driver) {
        await tx.driver.update({
          where: { id: driver.id },
          data: { kycStatus: 'rejected' } 
        });
      }

      // 5. Efetua o Soft Delete no Usuário
      await tx.user.update({
        where: { id: user.id },
        data: { deletedAt: new Date() }
      });

      return { message: 'Conta e dados pessoais inativados com sucesso. Conforme a LGPD e regulamentações financeiras, o histórico de transações é mantido de forma segura.' };
    });
  }

async getOnboardingData(user: User) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId: user.id },
      include: { 
        vehicles: { take: 1 },
        kycDocuments: true // <-- Incluímos os documentos na busca
      },
    });

    if (!driver) {
      return { driver: null, vehicle: null, uploadedDocs: [], uploadedPhotos: [] };
    }

    const vehicle = driver.vehicles.length > 0 ? driver.vehicles[0] : null;

    // Mapear os tipos de documentos KYC já enviados (ex: ['cnhFront', 'crlv'])
    const uploadedDocs = driver.kycDocuments.map(doc => doc.docType);

    // Mapear quais ângulos do carro já foram enviados (ex: ['front', 'side'])
    const uploadedPhotos = [];
    if (vehicle && vehicle.photos) {
      const photos = vehicle.photos as any;
      if (photos.front) uploadedPhotos.push('front');
      if (photos.side) uploadedPhotos.push('side');
      if (photos.rear) uploadedPhotos.push('rear');
    }

    return {
      driver: {
        name: user.name,
        cpf: driver.cpf,
        email: user.email, 
        optInPolitical: driver.optInPolitical,
      },
      vehicle: vehicle ? {
        plate: vehicle.plate,
        model: vehicle.model,
        year: vehicle.year,
        category: vehicle.category,
      } : null,
      uploadedDocs,
      uploadedPhotos,
    };
  }
}