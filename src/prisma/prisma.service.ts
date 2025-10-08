import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy {
    constructor() {
        super();
    }

    /**
     * Garante que a conexão com o banco de dados seja estabelecida
     * quando o módulo for inicializado.
     */
    async onModuleInit() {
        await this.$connect();
    }

    /**
     * Garante que a conexão com o banco de dados seja encerrada
     * graciosamente quando a aplicação for desligada.
     */
    async onModuleDestroy() {
        await this.$disconnect();
    }
}