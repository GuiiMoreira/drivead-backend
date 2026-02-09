import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsLatitude, IsLongitude, IsNumber, IsOptional, ValidateNested } from 'class-validator';

// DTO para um único ponto de geolocalização
export class PositionDto {
    @IsLatitude()
    lat: number;

    @IsLongitude()
    lon: number;

    @IsDateString()
    timestamp: string;

    @IsNumber()
    @IsOptional()
    speed?: number;
}

// DTO para o corpo da requisição, que é um array de posições (Batch)
// Renomeado de CreatePositionsDto para CreatePositionBatchDto
export class CreatePositionBatchDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PositionDto)
    positions: PositionDto[];
}