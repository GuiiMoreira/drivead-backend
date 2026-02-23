import { Controller, Post, Body, Query, HttpCode, HttpStatus, Logger, Headers, ForbiddenException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
    constructor(private readonly webhooksService: WebhooksService) {}

    @Post('payment')
    @HttpCode(HttpStatus.OK)
    async handleMercadoPagoWebhook(
        @Headers() headers: any,
        @Query() query: any, 
        @Body() body: any
    ) {
        // 1. Validação de Segurança (HMAC)
        // Se a assinatura não bater, rejeitamos a requisição.
        const isValid = this.webhooksService.validateSignature(headers, body, query);
        
        if (!isValid) {
            // Se falhar e tiver segredo configurado, rejeita.
            // Se não tiver segredo (dev), o service retorna true, então aqui só cai se for ataque mesmo.
            throw new ForbiddenException('Assinatura de Webhook Inválida.');
        }

        // 2. Processamento
        await this.webhooksService.handlePayment(query, body);

        // Sempre responde 200 OK para o Mercado Pago não reenviar
        return { received: true };
    }
}