import { Injectable, InternalServerErrorException, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignStatus, User } from '@prisma/client';
import { MercadoPagoConfig, Payment } from 'mercadopago';

@Injectable()
export class PaymentsService {
  private readonly client: MercadoPagoConfig;
  private readonly logger = new Logger(PaymentsService.name);
  private readonly webhookUrl: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const accessToken = this.configService.getOrThrow('MERCADO_PAGO_ACCESS_TOKEN');
    // Pega a URL base do backend (ex: https://drivead-backend.up.railway.app)
    const backendUrl = this.configService.get('BACKEND_URL') || 'http://localhost:3000'; 
    this.webhookUrl = `${backendUrl}/webhooks/payment`;

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

    // 2. Validação de Permissões (Otimizada)
    // Não precisamos buscar o User no banco de novo, o objeto `user` já tem o advertiserId
    if (!user.advertiserId) {
      throw new ForbiddenException('Usuário não vinculado a uma empresa (Anunciante).');
    }

    if (campaign.advertiserId !== user.advertiserId) {
      throw new ForbiddenException('Acesso negado. Esta campanha pertence a outra empresa.');
    }

    if (campaign.status !== CampaignStatus.draft) {
      throw new ForbiddenException(`Esta campanha não está aguardando pagamento. Status atual: ${campaign.status}`);
    }

    // 3. Criação do Pagamento no Mercado Pago
    const paymentApi = new Payment(this.client);

    const paymentData = {
      body: {
        transaction_amount: campaign.budget,
        description: `Pagamento da campanha: ${campaign.title}`,
        payment_method_id: 'pix',
        payer: {
          email: user.email || 'financeiro@drivead.com', // Fallback caso o user não tenha email
          first_name: user.name || 'Anunciante',
        },
        // A Referência Externa é a nossa "cola". Usamos o ID da campanha.
        external_reference: campaignId,
        notification_url: this.webhookUrl,
      },
    };

    try {
      const result = await paymentApi.create(paymentData);

      // Retorna os dados do PIX (Copia e Cola / QR Code)
      return result.point_of_interaction?.transaction_data;
    } catch (error) {
      this.logger.error(`Falha ao criar pagamento para campanha ${campaignId}`, error);
      throw new InternalServerErrorException('Falha na comunicação com o gateway de pagamento.');
    }
  }
}