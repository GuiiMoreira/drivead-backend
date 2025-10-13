import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, Max, Min, IsInt, ValidateNested, IsDefined, IsEnum, IsOptional } from 'class-validator';
import { VehicleCategory } from '@prisma/client';

// DTO para os detalhes do veículo
class VehicleProfileDto {
    @IsNotEmpty({ message: 'A placa do veículo é obrigatória.' })
    @IsString()
    plate: string;

    @IsNotEmpty({ message: 'O modelo do veículo é obrigatório.' })
    @IsString()
    model: string;

    @IsNotEmpty({ message: 'O ano do veículo é obrigatório.' })
    @IsInt()
    @Min(2000) // Regra de negócio: não aceitar carros muito antigos
    @Max(new Date().getFullYear() + 1)
    year: number;

    @IsEnum(VehicleCategory)
    @IsOptional()
    category?: VehicleCategory;
}

// DTO para os detalhes do motorista
class DriverProfileDto {
    @IsNotEmpty({ message: 'O nome do motorista é obrigatório.' })
    @IsString()
    name: string;

    @IsNotEmpty({ message: 'O CPF do motorista é obrigatório.' })
    @IsString()
    // Adicionar validador de CPF customizado em produção
    cpf: string;
}

// DTO principal que combina os dois
export class CreateDriverDto {
    @IsDefined()
    @IsNotEmpty()
    @ValidateNested()
    @Type(() => DriverProfileDto)
    driver: DriverProfileDto;

    @IsDefined()
    @IsNotEmpty()
    @ValidateNested()
    @Type(() => VehicleProfileDto)
    vehicle: VehicleProfileDto;
}