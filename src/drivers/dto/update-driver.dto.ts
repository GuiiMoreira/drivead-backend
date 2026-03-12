import { IsString, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { PixKeyType } from '@prisma/client';

export class UpdateDriverDto {
  @IsOptional()
  @IsEnum(PixKeyType, { message: 'Tipo de chave PIX inválido. Use: CPF, PHONE, EMAIL ou RANDOM.' })
  pixKeyType?: PixKeyType;

  @IsOptional()
  @IsString({ message: 'A chave PIX deve ser uma string.' })
  pixKey?: string;

  @IsOptional()
  @IsBoolean({ message: 'A preferência política deve ser um booleano (true/false).' })
  optInPolitical?: boolean;
}