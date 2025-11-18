import { IsString, IsOptional } from 'class-validator';

export class UpdateAdvertiserDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  cnpj?: string;
}
