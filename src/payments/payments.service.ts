import { Injectable, InternalServerErrorException, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignStatus, User } from '@prisma/client';
import { MercadoPagoConfig, Preference } from 'mercadopago'; // Usamos Preference para Checkout Pro

@Injectable()
export class PaymentsService {
  private readonly client: MercadoPagoConfig;
  private readonly logger = new Logger(PaymentsService.name);
  private readonly webhookUrl: string | undefined;
  private readonly accessToken: string;
  private readonly frontendUrl: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.accessToken = this.configService.getOrThrow('MERCADO_PAGO_ACCESS_TOKEN');
    
    // Identifica se estamos em modo Sandbox (Teste)
    const isSandbox = this.accessToken.startsWith('TEST-');
    this.logger.log(`Inicializando Mercado Pago (Checkout Pro). Modo: ${isSandbox ? 'SANDBOX 🏖️' : 'PRODUÇÃO 🚀'}`);

    // 1. Configuração do Webhook (Backend)
    const rawBackendUrl = this.configService.get('BACKEND_URL') || this.configService.get('API_URL');
    if (rawBackendUrl) {
      const cleanBackendUrl = rawBackendUrl.replace(/\/$/, '').trim();
      if (cleanBackendUrl.startsWith('http')) {
        this.webhookUrl = `${cleanBackendUrl}/webhooks/payment`;
        this.logger.log(`Webhook URL configurada: ${this.webhookUrl}`);
      }
    } else {
      this.logger.warn('BACKEND_URL não configurada. Webhooks não funcionarão (status não atualizará sozinho).');
    }

    // 2. Configuração do Retorno ao Frontend
    // Tenta pegar FRONTEND_URL, senão usa um fallback genérico ou localhost
    this.frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    this.logger.log(`Frontend URL para retorno: ${this.frontendUrl}`);

    this.client = new MercadoPagoConfig({ accessToken: this.accessToken });
  }

  /**
   * Cria uma PREFERÊNCIA de pagamento (Checkout Pro)
   * Retorna a URL para onde o usuário deve ser redirecionado.
   */
  async createPaymentOrder(campaignId: string, user: User) {
    // 1. Buscas e Validações
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    if (!user.advertiserId) throw new ForbiddenException('Usuário não é anunciante.');
    if (campaign.advertiserId !== user.advertiserId) throw new ForbiddenException('Acesso negado.');
    if (campaign.status !== CampaignStatus.draft) throw new ForbiddenException(`Status inválido: ${campaign.status}`);
    if (Number(campaign.budget) <= 0) throw new ForbiddenException('Valor inválido.');

    // 2. Inicializa PREFERENCE
    const preference = new Preference(this.client);
    const payerEmail = (user.email && user.email.includes('@')) ? user.email : 'financeiro@drivead.com';

    this.logger.log(`Criando Link de Pagamento. Campanha: ${campaignId}, Valor: ${campaign.budget}`);

    try {
      const result = await preference.create({
        body: {
          items: [
            {
              id: campaignId,
              title: `Campanha DriveAd: ${campaign.title}`,
              quantity: 1,
              unit_price: Number(campaign.budget),
              currency_id: 'BRL',
            }
          ],
          payer: {
            email: payerEmail,
            name: user.name || 'Anunciante',
          },
          external_reference: campaignId, // ID da campanha para conciliação no Webhook
          notification_url: this.webhookUrl,
          
          payment_methods: {
             excluded_payment_types: [], // Aceita tudo (PIX, Cartão, Boleto, Saldo)
             installments: 1 // Opcional: define max de parcelas
          },
          
          // URLs para onde o usuário volta após o pagamento no site do Mercado Pago
          back_urls: {
            success: `${this.frontendUrl}/campaigns/${campaignId}?status=success`, 
            failure: `${this.frontendUrl}/campaigns/${campaignId}?status=failure`,
            pending: `${this.frontendUrl}/campaigns/${campaignId}?status=pending`
          },
          auto_return: 'approved', // Redireciona automaticamente se aprovado
        }
      });

      // Lógica de Retorno Inteligente:
      // Se estivermos usando token de TESTE, preferimos o link de Sandbox.
      // Se for produção, usamos o init_point padrão.
      const redirectUrl = this.accessToken.startsWith('TEST-') 
        ? result.sandbox_init_point 
        : result.init_point;

      this.logger.log(`Link gerado com sucesso: ${redirectUrl}`);

      return redirectUrl; 
      
    } catch (error) {
      this.logger.error(`Erro ao criar preferência MP: ${error.message}`);
      if (error.response) {
         this.logger.error(JSON.stringify(error.response.data));
      }
      throw new InternalServerErrorException('Falha ao gerar link de pagamento.');
    }
  }
}