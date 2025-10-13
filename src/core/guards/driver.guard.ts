import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

@Injectable()
export class DriverGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (user && user.role === Role.driver) {
            return true;
        }

        throw new ForbiddenException('Acesso negado. Apenas motoristas podem executar esta ação.');
    }
}