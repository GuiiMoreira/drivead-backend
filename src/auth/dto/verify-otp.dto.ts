import { IsNotEmpty, IsPhoneNumber, IsString, Length, IsEnum, IsOptional } from 'class-validator';
import { Role } from '@prisma/client'; // Importe o Enum Role

export class VerifyOtpDto {
  @IsNotEmpty()
  @IsPhoneNumber('BR')
  phone: string;

  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  otp: string;

  @IsEnum(Role)
  @IsOptional() // O role é opcional
  role?: Role; // Ex: 'driver' ou 'advertiser'
}