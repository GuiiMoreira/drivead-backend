import { IsString, IsEnum, IsNotEmpty } from 'class-validator';
import { PixKeyType } from '@prisma/client';

export class UpdatePixDto {
  @IsEnum(PixKeyType, { message: 'Tipo de chave PIX inválido. Use: CPF, PHONE, EMAIL ou RANDOM.' })
  @IsNotEmpty({ message: 'O tipo da chave PIX é obrigatório.' })
  pixKeyType: PixKeyType;

  @IsString({ message: 'A chave PIX deve ser uma string.' })
  @IsNotEmpty({ message: 'A chave PIX é obrigatória.' })
  pixKey: string;
}