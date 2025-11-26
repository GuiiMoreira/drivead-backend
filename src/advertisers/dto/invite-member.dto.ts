import { IsString, IsNotEmpty, IsEnum, IsPhoneNumber } from 'class-validator';
import { AdvertiserRole, PermissionLevel } from '@prisma/client';

export class InviteMemberDto {
  @IsString() @IsNotEmpty()
  nome: string;

  @IsPhoneNumber('BR') @IsNotEmpty()
  telefone: string;

  @IsEnum(AdvertiserRole) @IsNotEmpty()
  cargo: AdvertiserRole;

  @IsEnum(PermissionLevel) @IsNotEmpty()
  permissao: PermissionLevel;
}