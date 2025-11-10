import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';

// DTO simples para a revisão, pode criar um ficheiro separado se preferir
class ReviewProofDto {
    approved: boolean;
    notes?: string;
}

@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

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
}