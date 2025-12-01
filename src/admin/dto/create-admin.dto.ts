import { IsString, IsNotEmpty, IsPhoneNumber } from 'class-validator';

export class CreateAdminDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsPhoneNumber('BR')
  @IsNotEmpty()
  phone: string;
}