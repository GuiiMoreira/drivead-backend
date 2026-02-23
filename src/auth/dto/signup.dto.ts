import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';
import { Role } from '@prisma/client'; // Certifique-se de que o Enum Role existe no seu Prisma

export class SignUpDto {
    @IsNotEmpty({ message: 'O número de telefone é obrigatório.' })
    @IsString()
    phone: string;

    // ADICIONADO: Permite que o frontend envie o 'role' no momento de pedir o OTP
    // sem causar o Erro 400 (Bad Request).
    @IsOptional()
    @IsEnum(Role, { message: 'Tipo de utilizador (role) inválido.' })
    role?: Role;
}