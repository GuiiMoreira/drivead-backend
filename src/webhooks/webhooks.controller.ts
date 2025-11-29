import { Controller, Post, Body, Query, HttpCode, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignStatus } from '@prisma/client';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { ConfigService } from '@nestjs/config';

@Controller('webhooks')
export class WebhooksController {
    private readonly logger = new Logger(WebhooksController.name);
    private readonly mpClient: MercadoPagoConfig;

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
    ) {
        // Precisamos do client do MP para verificar a autenticidade do pagamento
        const accessToken = this.configService.getOrThrow('MERCADO_PAGO_ACCESS_TOKEN');
        this.mpClient = new MercadoPagoConfig({ accessToken: accessToken });
    }

    @Post('payment')
    @HttpCode(HttpStatus.OK) // Sempre retorne 200 para o Mercado Pago
    async handleMercadoPagoWebhook(@Query() query: any, @Body() body: any) {
        this.logger.log('Recebido webhook do Mercado Pago:', body);

        // O Mercado Pago envia o ID do pagamento no query param `data.id`
        const paymentId = query['data.id'];

        if (body.type === 'payment' && paymentId) {
            try {
                const paymentApi = new Payment(this.mpClient);
                const payment = await paymentApi.get({ id: paymentId });

                const campaignId = payment.external_reference;
                const paymentStatus = payment.status;

                if (!campaignId) {
                    throw new NotFoundException('ID da campanha (external_reference) não encontrado no pagamento.');
                }

 if (paymentStatus === 'approved') {
  // ATUALIZAÇÃO: Muda para 'pending_approval' em vez de 'active'
  await this.prisma.campaign.updateMany({
    where: {
      id: campaignId,
      status: CampaignStatus.draft,
    },
    data: {
      status: CampaignStatus.pending_approval, // <--- MUDANÇA AQUI
    },
  });
  this.logger.log(`Campanha ${campaignId} paga. Aguardando aprovação do admin.`);
} else {
                    this.logger.log(`Status do pagamento ${paymentId} é: ${paymentStatus}`);
                }

            } catch (error) {
                this.logger.error('Erro ao processar webhook do Mercado Pago', error);
            }
        }

        // Responde OK para o Mercado Pago parar de enviar o webhook
        return { received: true };
    }
}