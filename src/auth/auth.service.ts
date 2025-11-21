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
    async sendOtp(phone: string): Promise<String> {
        // 1. Gera um código aleatório de 6 dígitos
        const otp = randomInt(100000, 999999).toString();

        // 2. Define a validade (ex: 5 minutos)
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 5);

        // 3. Guarda (ou atualiza) o código na base de dados
        await this.prisma.otpChallenge.upsert({
            where: { phone },
            update: {
                otpCode: otp,
                expiresAt: expiresAt,
            },
            create: {
                phone,
                otpCode: otp,
                expiresAt,
            },
        });

        // --- PONTO DE ENVIO DE SMS ---
        // Por enquanto, vamos registar no log para você poder ver no Railway.
        // No futuro, substituiremos esta linha pela chamada ao serviço de SMS (Twilio, Zenvia, etc.)
        this.logger.log(`🔑 [OTP REAL] Para ${phone}: ${otp}`);
        return `🔑 [OTP REAL] Para ${phone}: ${otp}`;
        // -----------------------------
    }
    /**
     * Verifica o OTP e, se válido, cria ou encontra o utilizador e gera os tokens.
     */
    async verifyOtpAndSignTokens(phone: string, otp: string, role?: Role) {
        // 1. Verifica o OTP (lógica de validação real)
        const challenge = await this.prisma.otpChallenge.findUnique({
            where: { phone },
        });

        if (!challenge || challenge.otpCode !== otp || new Date() > challenge.expiresAt) {
            throw new UnauthorizedException('Código OTP inválido ou expirado.');
        }

        // 2. Apaga o desafio para não ser usado novamente
        await this.prisma.otpChallenge.delete({ where: { phone } });

        // 3. Encontra ou cria o utilizador (registo de autenticação)
        let user = await this.prisma.user.findUnique({ where: { phone } });
        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    phone,
                    role: role || Role.driver,
                },
            });
        }

        // 4. --- LÓGICA DA CORREÇÃO ---
        // Verificamos se o perfil (Driver/Advertiser) já foi criado.
        // Esta é a verificação que realmente importa.
        let onboardingComplete = false;

        if (user.role === Role.driver) {
            const profile = await this.prisma.driver.findUnique({
                where: { userId: user.id },
            });
            if (profile) {
                onboardingComplete = true; // O perfil de motorista existe!
            }
        } else if (user.role === Role.advertiser) {
            const profile = await this.prisma.advertiser.findUnique({
                where: { userId: user.id },
            });
            if (profile) {
                onboardingComplete = true;
            }
        } else if (user.role === Role.admin) {
            onboardingComplete = true;
        }

        const tokens = await this._generateAndStoreTokens(user);

        return {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            user: {
                id: user.id,
                role: user.role,
                onboardingComplete: onboardingComplete,
            },
        };
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

    async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        driver: {
          include: { vehicles: true } // Opcional: já trazer o veículo no login
        }, 
        advertiser: true,
      },
    });

    if (!user) throw new UnauthorizedException('Utilizador não encontrado.');

    // Limpa campos desnecessários se quiser, ou retorna tudo
    return user;
  }
}
