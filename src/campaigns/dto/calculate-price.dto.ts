import { IsArray, IsEnum, IsInt, IsNotEmpty, Min } from 'class-validator';
import { VehicleCategory } from '@prisma/client';

export enum ExposureLevel {
    BASIC = 'BASIC',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
}

export class CalculatePriceDto {
    @IsArray()
    @IsEnum(VehicleCategory, { each: true })
    @IsNotEmpty()
    targetCategories: VehicleCategory[]; // Ex: [ESSENTIAL, SMART]

    @IsInt()
    @Min(1)
    durationDays: number; // Ex: 30

    @IsInt()
    @Min(1)
    numCars: number; // Ex: 50

    @IsEnum(ExposureLevel)
    @IsNotEmpty()
    exposureLevel: ExposureLevel; // Ex: HIGH
}