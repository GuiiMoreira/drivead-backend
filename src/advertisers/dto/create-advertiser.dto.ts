import { IsString, IsNotEmpty, IsEnum, IsOptional, IsBoolean, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CompanyType } from '@prisma/client';

class AddressDto {
  @IsString() @IsNotEmpty() logradouro: string;
  @IsString() @IsNotEmpty() numero: string;
  @IsString() @IsOptional() complemento?: string;
  @IsString() @IsNotEmpty() bairro: string;
  @IsString() @IsNotEmpty() cidade: string;
  @IsString() @IsNotEmpty() estado: string;
  @IsString() @IsNotEmpty() cep: string;
}

export class CreateAdvertiserDto {
  // Dados da Empresa
  @IsEnum(CompanyType)
  @IsNotEmpty()
  tipo_empresa: CompanyType;

  @IsString() @IsNotEmpty()
  cnpj: string;

  @IsString() @IsNotEmpty()
  razao_social: string;

  @IsString() @IsNotEmpty()
  nome_fantasia: string;

  @IsString() @IsOptional()
  segmento?: string;

  // Endereço
  @ValidateNested()
  @Type(() => AddressDto)
  @IsNotEmpty()
  endereco: AddressDto;

  // Configurações
  @IsNumber() @IsOptional()
  limite_orcamento_mensal?: number;

  @IsBoolean() @IsNotEmpty()
  modo_agencia: boolean;
}