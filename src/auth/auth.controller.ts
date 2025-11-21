import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { SignUpDto } from './dto/signup.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('signup')
    @HttpCode(HttpStatus.OK)
    async signUp(@Body() signUpDto: SignUpDto) {
        const message = await this.authService.sendOtp(signUpDto.phone);
        return {
            success: true,
            //TODO: ALTERAR MENSAGEM APÓS IMPLEMENTAÇÃO DO SMS REAL.
            message: message,
        };
    }

    @Post('verify-otp')
    async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
        const tokenData = await this.authService.verifyOtpAndSignTokens(
            verifyOtpDto.phone,
            verifyOtpDto.otp,
            verifyOtpDto.role,
        );
        return {
            success: true,
            data: tokenData,
        };
    }

@UseGuards(AuthGuard('jwt'))
  @Get('me')
  async getProfile(@Req() req) {
    // Chamamos um método no serviço para buscar os dados completos
    const userProfile = await this.authService.getMe(req.user.id);
    
    return {
      success: true,
      data: userProfile,
    };
  }

    /**
  * NOVO ENDPOINT: Recebe um refresh token e retorna um novo par de tokens.
  */
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
        const tokenData = await this.authService.refreshToken(refreshTokenDto.refreshToken);
        return {
            success: true,
            data: tokenData,
        };
    }

    /**
     * NOVO ENDPOINT: Invalida os tokens do utilizador autenticado.
     */
    @UseGuards(AuthGuard('jwt'))
    @Post('logout')
    @HttpCode(HttpStatus.OK)
    async logout(@Req() req) {
        // req.user.id está disponível graças à JwtStrategy
        return this.authService.logout(req.user.id);
    }
}
