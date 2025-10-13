import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray } from 'class-validator';

export class CreateInstallerDto {
    @IsString()
    @IsNotEmpty()
    companyName: string;

    @IsString()
    @IsNotEmpty()
    phone: string;

    @IsString()
    @IsNotEmpty()
    address: string;

    @IsArray()
    @IsOptional()
    areas?: string[];

    @IsNumber()
    @IsOptional()
    priceInstall?: number;
}