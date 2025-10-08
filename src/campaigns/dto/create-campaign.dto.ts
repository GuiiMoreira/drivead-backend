import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsEnum, IsObject, IsDateString, IsNumber, Min, ValidateNested, IsArray, IsOptional } from 'class-validator';
import { CampaignType } from '@prisma/client';

class CampaignPreferencesDto {
    @IsNumber()
    @IsOptional()
    min_km_per_day?: number;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    vehicle_types?: string[];
}

class CampaignCreativeDto {
    @IsString()
    @IsNotEmpty()
    file_url: string;

    @IsString()
    @IsNotEmpty()
    format: string;
}

export class CreateCampaignDto {
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsEnum(CampaignType)
    @IsNotEmpty()
    type: CampaignType; // 'commercial' ou 'political'

    @IsObject()
    @IsNotEmpty()
    area_geojson: object;

    @IsDateString()
    @IsNotEmpty()
    start: string;

    @IsDateString()
    @IsNotEmpty()
    end: string;

    @IsNumber()
    @Min(1)
    budget: number;

    @IsNumber()
    @Min(1)
    num_cars: number;

    @ValidateNested()
    @Type(() => CampaignPreferencesDto)
    @IsOptional()
    preferences?: CampaignPreferencesDto;

    @ValidateNested()
    @Type(() => CampaignCreativeDto)
    @IsNotEmpty()
    creative: CampaignCreativeDto;
}