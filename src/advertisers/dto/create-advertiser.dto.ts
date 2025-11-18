import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateAdvertiserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Length(11, 18) // CPF (11) or CNPJ (14) with punctuation
  cpfOrCnpj: string;
}
