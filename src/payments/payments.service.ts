import { Injectable, InternalServerErrorException, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Campaign, CampaignStatus, User } from '@prisma/client';
import { MercadoPagoConfig, Payment } from 'mercadopago';

@Injectable()
export class PaymentsService {
    private readonly client: MercadoPagoConfig;
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
    ) {
        const accessToken = this.configService.getOrThrow('MERCADO_PAGO_ACCESS_TOKEN');
        this.client = new MercadoPagoConfig({ accessToken: accessToken });
    }

    /**
     * Cria uma ordem de pagamento (PIX) no Mercado Pago para uma campanha.
     */
    async createPaymentOrder(campaignId: string, user: User) {
        const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
        const advertiser = await this.prisma.advertiser.findUnique({ where: { userId: user.id } });

        if (!campaign) throw new NotFoundException('Campanha não encontrada.');
        if (!advertiser) throw new ForbiddenException('Perfil de anunciante não encontrado.');
        if (campaign.advertiserId !== advertiser.id) throw new ForbiddenException('Acesso negado a esta campanha.');
        if (campaign.status !== CampaignStatus.draft) throw new ForbiddenException('Esta campanha não está aguardando pagamento.');

        const paymentApi = new Payment(this.client);

        // O URL do webhook deve ser público. Use um serviço como Ngrok para testes locais.
        const notificationUrl = 'https://seu-dominio-publico.com/webhooks/payment';

        const paymentData = {
            body: {
                transaction_amount: campaign.budget,
                description: `Pagamento da campanha: ${campaign.title}`,
                payment_method_id: 'pix',
                payer: {
                    email: user.email || 'teste@drivead.com', // O e-mail do utilizador é ideal
                    first_name: user.name || 'Anunciante',
                },
                // A Referência Externa é a nossa "cola". Usamos o ID da campanha
                // para sabermos qual campanha ativar quando recebermos o webhook.
                external_reference: campaignId,
                notification_url: notificationUrl,
            },
        };

        try {
            const result = await paymentApi.create(paymentData);

            // Retorna os dados do PIX (Copia e Cola / QR Code) para o frontend
            return result.point_of_interaction!.transaction_data;
        } catch (error) {
            this.logger.error('Falha ao criar pagamento no Mercado Pago', error);
            throw new InternalServerErrorException('Falha ao processar pagamento.');
        }
    }
}