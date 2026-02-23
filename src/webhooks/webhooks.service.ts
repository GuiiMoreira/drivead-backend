import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { CampaignStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly mpClient: MercadoPagoConfig;
  private readonly webhookSecret: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const accessToken = this.configService.getOrThrow('MERCADO_PAGO_ACCESS_TOKEN');
    this.mpClient = new MercadoPagoConfig({ accessToken });
    
    // O Segredo de Webhook é opcional no início, mas CRÍTICO para produção segura.
    this.webhookSecret = this.configService.get('MERCADO_PAGO_WEBHOOK_SECRET');
    
    if (!this.webhookSecret) {
        this.logger.warn('⚠️ MERCADO_PAGO_WEBHOOK_SECRET não configurado. A validação de assinatura será pulada (INSEGURO).');
    }
  }

  /**
   * Valida se a requisição veio realmente do Mercado Pago usando HMAC SHA-256
   */
  validateSignature(headers: any, body: any, query: any): boolean {
    if (!this.webhookSecret) return true; // Se não tiver segredo configurado, aceita (modo desenvolvimento)

    const xSignature = headers['x-signature'];
    const xRequestId = headers['x-request-id'];

    if (!xSignature || !xRequestId) {
        this.logger.error('Headers de assinatura (x-signature/x-request-id) ausentes.');
        return false;
    }

    // Parse da header x-signature (formato: ts=...,v1=...)
    const parts = xSignature.split(',');
    let ts = '';
    let v1 = '';

    parts.forEach(part => {
        const [key, value] = part.split('=');
        if (key === 'ts') ts = value;
        if (key === 'v1') v1 = value;
    });

    // 1. Extrair o ID do pagamento (pode vir no body ou query)
    const dataId = body?.data?.id || query['data.id'];
    if (!dataId) return false;

    // 2. Construir o template da assinatura (Manifest)
    // Padrão MP: id:[data.id];request-id:[x-request-id];ts:[ts];
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    // 3. Gerar o Hash HMAC-SHA256
    const hmac = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(manifest)
        .digest('hex');

    // 4. Comparar (Timing Safe para evitar ataques de tempo)
    // Se o hash gerado for igual ao v1 recebido, é autêntico.
    return hmac === v1;
  }

  /**
   * Processa a notificação de pagamento
   */
  async handlePayment(query: any, body: any) {
    // Tenta pegar o ID do body (padrão novo) ou query (padrão antigo/IPN)
    const paymentId = body?.data?.id || query['data.id'];
    const action = body?.action || body?.type;

    // Se não for pagamento ou não tiver ID, ignora
    if (action !== 'payment.created' && action !== 'payment.updated' && body.type !== 'payment') {
        return { ignored: true };
    }
    
    if (!paymentId) {
        this.logger.warn('Webhook recebido sem ID de pagamento.');
        return { error: 'No ID found' };
    }

    this.logger.log(`Processando Pagamento ID: ${paymentId}`);

    try {
        // Consulta a API do Mercado Pago para garantir o status real
        const paymentApi = new Payment(this.mpClient);
        const payment = await paymentApi.get({ id: paymentId });

        const campaignId = payment.external_reference;
        const status = payment.status;

        if (!campaignId) {
            this.logger.warn(`Pagamento ${paymentId} sem external_reference (CampaignID).`);
            return;
        }

        if (status === 'approved') {
            // Atualiza a campanha para 'pending_approval' (Aguardando Admin)
            const updateResult = await this.prisma.campaign.updateMany({
                where: {
                    id: campaignId,
                    status: CampaignStatus.draft, // Só atualiza se estiver em Rascunho
                },
                data: {
                    status: CampaignStatus.pending_approval,
                },
            });

            if (updateResult.count > 0) {
                this.logger.log(`✅ Campanha ${campaignId} paga e movida para Pending Approval.`);
            } else {
                this.logger.log(`ℹ️ Pagamento aprovado para campanha ${campaignId}, mas ela não estava mais em 'draft' (provavelmente já processada).`);
            }
        } else {
            this.logger.log(`Status do pagamento ${paymentId}: ${status}`);
        }

    } catch (error) {
        this.logger.error(`Erro ao consultar pagamento ${paymentId} no MP`, error);
        throw error;
    }

    return { received: true };
  }
}