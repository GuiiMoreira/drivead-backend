import { Injectable, InternalServerErrorException, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignStatus, User } from '@prisma/client';
import { MercadoPagoConfig, Payment } from 'mercadopago';

@Injectable()
export class PaymentsService {
  private readonly client: MercadoPagoConfig;
  private readonly logger = new Logger(PaymentsService.name);
  private readonly webhookUrl: string | undefined;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const accessToken = this.configService.getOrThrow('MERCADO_PAGO_ACCESS_TOKEN');
    
    // Pega a URL base do backend (ex: https://drivead-backend.up.railway.app)
    // REMOVIDO fallback para localhost pois causa erro de validação "must be url valid" no Mercado Pago
    const rawBackendUrl = this.configService.get('BACKEND_URL') || this.configService.get('API_URL');
    
    if (rawBackendUrl) {
      // Remove barra final e espaços em branco que podem vir do .env
      const cleanBackendUrl = rawBackendUrl.replace(/\/$/, '').trim();
      
      // Valida se parece uma URL real
      if (cleanBackendUrl.startsWith('http')) {
        this.webhookUrl = `${cleanBackendUrl}/webhooks/payment`;
        this.logger.log(`Webhook URL configurada com sucesso: ${this.webhookUrl}`);
      } else {
        this.logger.warn(`BACKEND_URL informada não parece válida (${cleanBackendUrl}). Webhooks ignorados.`);
      }
    } else {
      this.logger.warn('BACKEND_URL/API_URL não configurada. Pagamentos serão criados sem notificação automática (Webhook).');
    }

    this.client = new MercadoPagoConfig({ accessToken: accessToken });
  }

  /**
   * Cria uma ordem de pagamento (PIX) no Mercado Pago para uma campanha.
   */
  async createPaymentOrder(campaignId: string, user: User) {
    // 1. Busca a campanha
    const campaign = await this.prisma.campaign.findUnique({ 
      where: { id: campaignId } 
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada.');
    }

    // 2. Validação de Permissões
    if (!user.advertiserId) {
      throw new ForbiddenException('Usuário não vinculado a uma empresa (Anunciante).');
    }

    if (campaign.advertiserId !== user.advertiserId) {
      throw new ForbiddenException('Acesso negado. Esta campanha pertence a outra empresa.');
    }

    if (campaign.status !== CampaignStatus.draft) {
      throw new ForbiddenException(`Esta campanha não está aguardando pagamento. Status atual: ${campaign.status}`);
    }

    // 3. Validação de Valor
    if (Number(campaign.budget) <= 0) {
        throw new ForbiddenException('O valor da campanha deve ser maior que zero.');
    }

    // 4. Criação do Pagamento no Mercado Pago
    const paymentApi = new Payment(this.client);

    // Garante formato de email válido ou usa fallback
    const payerEmail = (user.email && user.email.includes('@')) ? user.email : 'financeiro@drivead.com';

    // Log para depuração em produção
    this.logger.log(`Criando PIX. Campanha: ${campaignId}, Valor: ${campaign.budget}, Webhook: ${this.webhookUrl || 'DESATIVADO'}`);

    const paymentData = {
      body: {
        transaction_amount: Number(campaign.budget),
        description: `Campanha DriveAd: ${campaign.title.substring(0, 30)}`,
        payment_method_id: 'pix',
        payer: {
          email: payerEmail,
          first_name: user.name || 'Anunciante',
        },
        // A Referência Externa é a nossa "cola". Usamos o ID da campanha.
        external_reference: campaignId,
        // Só envia notification_url se ela estiver definida e válida. Enviar undefined faz o MP ignorar o campo (correto).
        notification_url: this.webhookUrl,
      },
      requestOptions: { idempotencyKey: `${campaignId}-${Date.now()}` } // Evita pagamentos duplicados acidentais
    };

    try {
      const result = await paymentApi.create(paymentData);

      this.logger.log(`Pagamento criado com sucesso no MP. ID: ${result.id}`);

      // Retorna os dados do PIX (Copia e Cola / QR Code)
      return result.point_of_interaction?.transaction_data;
      
    } catch (error) {
      // --- LOG DETALHADO DE ERRO ---
      this.logger.error(`Falha ao criar pagamento para campanha ${campaignId}`);
      
      // Tenta extrair a mensagem real do Mercado Pago
      if (error.api_response) {
          this.logger.error(`Erro API MP Status: ${error.api_response.status}`);
          this.logger.error(`Erro API MP Body: ${JSON.stringify(error.api_response.body, null, 2)}`);
      } else if (error.response) {
          this.logger.error(`Erro MP Response: ${JSON.stringify(error.response.data, null, 2)}`);
      } else {
          this.logger.error(`Erro genérico: ${error.message}`, error.stack);
      }
      
      throw new InternalServerErrorException('Falha na comunicação com o gateway de pagamento. Verifique os logs do servidor.');
    }
  }
}