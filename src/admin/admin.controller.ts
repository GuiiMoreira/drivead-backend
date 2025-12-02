import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { CreateAdminDto } from './dto/create-admin.dto';
import { DocValidationStatus } from '@prisma/client';

// DTO simples para a revisão, pode criar um ficheiro separado se preferir
class ReviewProofDto {
    approved: boolean;
    notes?: string;
}

class ReviewAdvertiserDto {
  action: 'approve' | 'reject';
  reason?: string;
}

class ReviewCampaignDto {
  action: 'approve' | 'reject';
  reason?: string;
}

class ResolveFraudDto {
  action: 'dismiss' | 'penalize';
  notes?: string;
}

@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    // --- DASHBOARD & MONITORAMENTO (NOVOS) ---

  @Get('stats')
  async getDashboardStats() {
    const stats = await this.adminService.getDashboardStats();
    return { success: true, data: stats };
  }

  @Get('monitoring/active-drivers')
  async getActiveDriversLocations() {
    const locations = await this.adminService.getActiveDriversLocations();
    return { success: true, data: locations };
  }

    // --- Motoristas ---
    @Get('drivers/pending')
    async getPendingDrivers() {
        const drivers = await this.adminService.listPendingDrivers();
        return { success: true, data: drivers };
    }

    @Post('drivers/:id/approve')
    async approveDriver(@Param('id', ParseUUIDPipe) id: string) {
        const driver = await this.adminService.approveDriver(id);
        return { success: true, message: `Motorista aprovado.`, data: driver };
    }

    // --- Financeiro ---
    @Post('assignments/:id/process-payout')
    async processPayout(@Param('id', ParseUUIDPipe) id: string) {
        const assignment = await this.adminService.processAssignmentPayout(id);
        return { success: true, message: `Pagamento processado.`, data: assignment };
    }

    @Get('wallet/pending-withdrawals')
    async getPendingWithdrawals() {
        const withdrawals = await this.adminService.listPendingWithdrawals();
        return { success: true, data: withdrawals };
    }

    @Post('wallet/approve-withdrawal/:id')
    async approveWithdrawal(@Param('id', ParseUUIDPipe) id: string) {
        const transaction = await this.adminService.approveWithdrawal(id);
        return { success: true, message: `Saque concluído.`, data: transaction };
    }

    // --- NOVOS ENDPOINTS DE PROVAS ---

    @Get('proofs/installations/pending')
    async getPendingInstallations() {
        const proofs = await this.adminService.listPendingInstallations();
        return { success: true, data: proofs };
    }

    @Post('proofs/installations/:id/review')
    async reviewInstallation(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: ReviewProofDto,
    ) {
        const proof = await this.adminService.reviewInstallation(id, body.approved, body.notes);
        return {
            success: true,
            message: `Instalação ${body.approved ? 'aprovada' : 'rejeitada'}.`,
            data: proof,
        };
    }

    @Get('proofs/periodic/pending')
    async getPendingPeriodicProofs() {
        const proofs = await this.adminService.listPendingPeriodicProofs();
        return { success: true, data: proofs };
    }

    @Post('proofs/periodic/:id/review')
    async reviewPeriodicProof(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: ReviewProofDto,
    ) {
        const proof = await this.adminService.reviewPeriodicProof(id, body.approved, body.notes);
        return {
            success: true,
            message: `Prova periódica ${body.approved ? 'aprovada' : 'rejeitada'}.`,
            data: proof,
        };
    }
// --- CAMPANHAS ---
  @Get('campaigns/pending')
  async getPendingCampaigns() {
    const campaigns = await this.adminService.listPendingCampaigns();
    return { success: true, data: campaigns };
  }

  @Post('campaigns/:id/review')
  async reviewCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewCampaignDto
  ) {
    const result = await this.adminService.reviewCampaign(id, body.action, body.reason);
    return { 
      success: true, 
      message: `Campanha ${body.action === 'approve' ? 'aprovada' : 'rejeitada'}.`,
      data: result 
    };
  }

  // --- ANTI-FRAUDE ---
  @Get('fraud-alerts')
  async getFraudAlerts() {
    const alerts = await this.adminService.listFraudAlerts();
    return { success: true, data: alerts };
  }

  @Post('fraud-alerts/:id/resolve')
  async resolveFraudAlert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResolveFraudDto
  ) {
    const result = await this.adminService.resolveFraudAlert(id, body.action, body.notes);
    return { success: true, ...result };
  }
// --- VISÃO GERAL ---

  @Get('drivers')
  async getAllDrivers() {
    const drivers = await this.adminService.listAllDrivers();
    return { success: true, data: drivers };
  }

  @Get('drivers/:id')
  async getDriverDetails(@Param('id', ParseUUIDPipe) id: string) {
    const driver = await this.adminService.getDriverDetails(id);
    return { success: true, data: driver };
  }

  @Get('campaigns')
  async getAllCampaigns() {
    const campaigns = await this.adminService.listAllCampaigns();
    return { success: true, data: campaigns };
  }

  // --- GESTÃO DE ADMINS ---

  @Get('users/admins')
  async getAdmins() {
    const admins = await this.adminService.listAdmins();
    return { success: true, data: admins };
  }

  @Post('users/admins')
  async createAdmin(@Body() dto: CreateAdminDto) {
    const newAdmin = await this.adminService.createAdmin(dto);
    return {
      success: true,
      message: 'Novo administrador criado com sucesso.',
      data: newAdmin,
    };
  }
// --- GESTÃO DE ANUNCIANTES ---

  @Get('advertisers')
  async getAdvertisers(@Query('status') status?: DocValidationStatus) {
    // Permite filtrar na URL: /admin/advertisers?status=PENDENTE
    const advertisers = await this.adminService.listAdvertisers(status);
    return { success: true, data: advertisers };
  }

  @Get('advertisers/:id')
  async getAdvertiserDetails(@Param('id', ParseUUIDPipe) id: string) {
    const advertiser = await this.adminService.getAdvertiserDetails(id);
    return { success: true, data: advertiser };
  }

  @Post('advertisers/:id/review')
  async reviewAdvertiser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewAdvertiserDto
  ) {
    const result = await this.adminService.reviewAdvertiser(id, body.action, body.reason);
    return {
      success: true,
      message: `Empresa ${body.action === 'approve' ? 'aprovada' : 'rejeitada'}.`,
      data: result,
    };
  }
}