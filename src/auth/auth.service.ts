import { Injectable, UnauthorizedException, Logger, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { randomInt, randomBytes, createHash } from 'crypto';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
    ) { }

    /**
     * Gera e armazena um código OTP para um número de telemóvel.
     * Em produção, isto deve integrar-se com um gateway de SMS.
     */
    async sendOtp(phone: string): Promise<void> {
        const otp = randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Validade de 10 minutos

        // Utiliza `upsert` para criar ou atualizar o desafio OTP no banco de dados.
        // NOTE: A tabela `otp_challenges` precisa de ser adicionada ao `schema.prisma`.
        // Por simplicidade, vamos simular o armazenamento e o envio.

        this.logger.log(`OTP para ${phone}: ${otp}`); // Simulação do envio de SMS
        // Em um caso real, você guardaria `otp` e `expiresAt` no Redis ou no DB.
    }

    /**
     * Verifica o OTP e, se válido, cria ou encontra o utilizador e gera os tokens.
     */
    async verifyOtpAndSignTokens(phone: string, otp: string) {
        // A sua lógica de verificação de OTP aqui...
        if (otp !== '123456') { // TODO: Substituir pela verificação real
            throw new UnauthorizedException('Código OTP inválido ou expirado.');
        }

        let user = await this.prisma.user.findUnique({ where: { phone } });

        if (!user) {
            user = await this.prisma.user.create({
                data: { phone, role: Role.driver },
            });
        }

        // Gera e armazena os tokens
        return this._generateAndStoreTokens(user);
    }

    /**
     * NOVO MÉTODO: Lida com a requisição de refresh.
     */
    async refreshToken(token: string) {
        // A correção está nesta linha
        const hashedToken = createHash('sha256').update(token).digest('hex');

        const refreshToken = await this.prisma.refreshToken.findUnique({
            where: { tokenHash: hashedToken },
            include: {
                user: true,
            },
        });

        if (!refreshToken || refreshToken.revokedAt) {
            throw new ForbiddenException('Acesso negado. O token é inválido ou foi revogado.');
        }

        await this.prisma.refreshToken.update({
            where: { id: refreshToken.id },
            data: { revokedAt: new Date() },
        });

        return this._generateAndStoreTokens(refreshToken.user);
    }

    /**
     * NOVO MÉTODO: Faz o logout, invalidando todos os refresh tokens de um utilizador.
     */
    async logout(userId: string) {
        await this.prisma.refreshToken.updateMany({
            where: {
                userId: userId,
                revokedAt: null, // Apenas invalida os que ainda estão ativos
            },
            data: {
                revokedAt: new Date(),
            },
        });
        return { success: true, message: 'Logout realizado com sucesso.' };
    }

    /**
     * NOVO MÉTODO PRIVADO: Centraliza a geração e armazenamento de tokens.
     */
    private async _generateAndStoreTokens(user: User) {
        // 1. Gera o Access Token (curta duração)
        const payload = { sub: user.id, phone: user.phone, role: user.role };
        const accessToken = this.jwtService.sign(payload, {
            expiresIn: process.env.JWT_EXPIRES_IN,
            secret: process.env.JWT_SECRET,
        });

        // 2. Gera o Refresh Token (longa duração)
        const refreshToken = randomBytes(64).toString('hex');
        const hashedRefreshToken = createHash('sha256').update(refreshToken).digest('hex');

        // 3. Armazena o hash do refresh token no banco de dados
        await this.prisma.refreshToken.create({
            data: {
                userId: user.id,
                tokenHash: hashedRefreshToken,
            },
        });

        return {
            access_token: accessToken,
            refresh_token: refreshToken, // Retorna o token original para o cliente
            user: { id: user.id, role: user.role },
        };
    }


    /**
  * Busca um perfil de utilizador pelo ID.
  * @param userId - O ID do utilizador (extraído do payload do JWT).
  */
    async getProfile(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('Utilizador não encontrado.');
        }

        // Remove campos sensíveis se necessário antes de retornar
        // delete user.password; (exemplo se tivesse password)

        return user;
    }
}