import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(private prisma: PrismaService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: process.env.JWT_SECRET as string,
        });
    }

    async validate(payload: { sub: string; phone: string; role: string }) {
        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) {
            throw new UnauthorizedException();
        }
        return user; // O objeto `user` será anexado a `req.user`
    }
}