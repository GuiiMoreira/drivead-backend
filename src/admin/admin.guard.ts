import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        // A JwtStrategy anexa o `user` à requisição.
        // Verificamos se o utilizador existe e se a sua role é 'admin'.
        if (user && user.role === Role.admin) {
            return true;
        }

        throw new ForbiddenException('Acesso negado. Apenas administradores podem executar esta ação.');
    }
}