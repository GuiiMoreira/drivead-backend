import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsObject, ValidateNested, IsArray, IsEnum, IsInt, Min, IsOptional } from 'class-validator';
import { CampaignType, VehicleCategory } from '@prisma/client';
import { ExposureLevel } from './calculate-price.dto'; // Importando o Enum do outro DTO

// Mantemos o DTO de criativo como antes
class CampaignCreativeDto {
    @IsString()
    @IsNotEmpty()
    file_url: string;

    @IsString()
    @IsNotEmpty()
    format: string;
}

export class CreateCampaignDto {
    // --- Campos descritivos da campanha ---
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsObject()
    @IsNotEmpty()
    area_geojson: object;

    @ValidateNested()
    @Type(() => CampaignCreativeDto)
    @IsNotEmpty()
    creative: CampaignCreativeDto;

    // --- Campos para o cálculo de preço (Fatores do SmartPricing) ---
    @IsArray()
    @IsEnum(VehicleCategory, { each: true })
    @IsNotEmpty()
    targetCategories: VehicleCategory[];

    @IsInt()
    @Min(1)
    durationDays: number;

    @IsInt()
    @Min(1)
    numCars: number;

    @IsEnum(ExposureLevel)
    @IsNotEmpty()
    exposureLevel: ExposureLevel;

    // O campo `type` (commercial/political) continua importante
    @IsEnum(CampaignType)
    @IsNotEmpty()
    type: CampaignType;
}