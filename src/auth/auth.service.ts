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
    // 1. REGRA DE TESTE (Bypass de SMS)
    // Se o telefone começar com +557199999, não gera código aleatório nem grava no banco.
    if (phone.startsWith('+557199999')) {
      this.logger.log(`[TEST MODE] Telefone de teste detectado: ${phone}. Código fixo será 123456.`);
      return `🔑 [OTP TESTE] Para ${phone}: 123456`;
    }

    // 2. Gera um código aleatório de 6 dígitos
    const otp = randomInt(100000, 999999).toString();

    // 3. Define a validade (ex: 5 minutos)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    // 4. Guarda (ou atualiza) o código na base de dados
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
    this.logger.log(`🔑 [OTP REAL] Para ${phone}: ${otp}`);
    return `🔑 [OTP REAL] Para ${phone}: ${otp}`;
    // -----------------------------
  }

  /**
   * Verifica o OTP e, se válido, cria ou encontra o utilizador e gera os tokens.
   */
  async verifyOtpAndSignTokens(phone: string, otp: string, role?: Role) {
    // 1. Lógica de Validação (Teste vs Real)
    if (phone.startsWith('+557199999')) {
      // --- BYPASS DE TESTE ---
      if (otp !== '123456') {
        throw new UnauthorizedException('Código de teste incorreto. Use 123456.');
      }
      this.logger.log(`[TEST MODE] Login de teste realizado para ${phone}`);
    } else {
      // --- VALIDAÇÃO REAL ---
      const challenge = await this.prisma.otpChallenge.findUnique({
        where: { phone },
      });

      if (!challenge || challenge.otpCode !== otp || new Date() > challenge.expiresAt) {
        throw new UnauthorizedException('Código OTP inválido ou expirado.');
      }

      // Apaga o desafio para não ser usado novamente
      await this.prisma.otpChallenge.delete({ where: { phone } });
    }

    // 2. Encontra ou cria o utilizador (registo de autenticação)
    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
          role: role || Role.driver,
        },
      });
    }

    // 3. Verificação de Onboarding Completo
    let onboardingComplete = false;

    if (user.role === Role.driver) {
      const profile = await this.prisma.driver.findUnique({
        where: { userId: user.id },
      });
      if (profile) {
        onboardingComplete = true; // O perfil de motorista existe!
      }
    } else if (user.role === Role.advertiser) {
      if (user.advertiserId) {
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
   * Lida com a requisição de refresh.
   */
  async refreshToken(token: string) {
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
   * Faz o logout, invalidando todos os refresh tokens de um utilizador.
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
   * Centraliza a geração e armazenamento de tokens.
   */
  private async _generateAndStoreTokens(user: User) {
    // 1. Gera o Access Token (curta duração)
    const payload = { sub: user.id, phone: user.phone, role: user.role };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m', // Fallback se variável não existir
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
        // REMOVIDO: 'expiresAt' causava erro pois não existe no schema.prisma atual.
        // A gestão de expiração fica implícita ou deve ser adicionada ao schema futuramente.
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
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Utilizador não encontrado.');
    }
    return user;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        driver: {
          include: { vehicles: true }
        },
        advertiser: true,
      },
    });

    if (!user) throw new UnauthorizedException('Utilizador não encontrado.');

    return user;
  }
}