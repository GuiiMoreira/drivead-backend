import { Injectable, UnauthorizedException, Logger, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { randomInt, randomBytes, createHash } from 'crypto';
import { Role, User } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) { }

  async sendOtp(phone: string): Promise<String> {
    if (phone.startsWith('+557199999')) {
      this.logger.log(`[TEST MODE] Telefone de teste detectado: ${phone}. Código fixo será 123456.`);
      return `🔑 [OTP TESTE] Para ${phone}: 123456`;
    }

    const otp = randomInt(100000, 999999).toString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    await this.prisma.otpChallenge.upsert({
      where: { phone },
      update: { otpCode: otp, expiresAt: expiresAt },
      create: { phone, otpCode: otp, expiresAt },
    });

    this.logger.log(`🔑 [OTP REAL] Para ${phone}: ${otp}`);
    return `🔑 [OTP REAL] Para ${phone}: ${otp}`;
  }

  async verifyOtpAndSignTokens(phone: string, otp: string, role?: Role) {
    if (phone.startsWith('+557199999')) {
      if (otp !== '123456') throw new UnauthorizedException('Código de teste incorreto. Use 123456.');
      this.logger.log(`[TEST MODE] Login de teste realizado para ${phone}`);
    } else {
      const challenge = await this.prisma.otpChallenge.findUnique({ where: { phone } });

      if (!challenge || challenge.otpCode !== otp || new Date() > challenge.expiresAt) {
        throw new UnauthorizedException('Código OTP inválido ou expirado.');
      }
      await this.prisma.otpChallenge.delete({ where: { phone } });
    }

    let user = await this.prisma.user.findUnique({ where: { phone } });
    
    // --- BLOQUEIO DE SEGURANÇA (SOFT DELETE) ---
    if (user && user.deletedAt) {
      throw new ForbiddenException('Esta conta foi excluída. Entre em contato com o suporte para reativá-la.');
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
          role: role || Role.driver,
        },
      });
    }

    let onboardingComplete = false;
    if (user.role === Role.driver) {
      const profile = await this.prisma.driver.findUnique({ where: { userId: user.id } });
      if (profile) onboardingComplete = true;
    } else if (user.role === Role.advertiser) {
      if (user.advertiserId) onboardingComplete = true;
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

  async refreshToken(token: string) {
    const hashedToken = createHash('sha256').update(token).digest('hex');

    const refreshToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashedToken },
      include: { user: true },
    });

    if (!refreshToken || refreshToken.revokedAt || refreshToken.user.deletedAt) {
      throw new ForbiddenException('Acesso negado. O token é inválido, foi revogado ou a conta foi excluída.');
    }

    await this.prisma.refreshToken.update({
      where: { id: refreshToken.id },
      data: { revokedAt: new Date() },
    });

    return this._generateAndStoreTokens(refreshToken.user);
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId: userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true, message: 'Logout realizado com sucesso.' };
  }

  private async _generateAndStoreTokens(user: User) {
    const payload = { sub: user.id, phone: user.phone, role: user.role };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      secret: process.env.JWT_SECRET,
    });

    const refreshToken = randomBytes(64).toString('hex');
    const hashedRefreshToken = createHash('sha256').update(refreshToken).digest('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashedRefreshToken,
      },
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: { id: user.id, role: user.role },
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Utilizador não encontrado.');
    return user;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        driver: { include: { vehicles: true } },
        advertiser: true,
      },
    });

    if (!user || user.deletedAt) throw new UnauthorizedException('Utilizador não encontrado.');
    return user;
  }
}