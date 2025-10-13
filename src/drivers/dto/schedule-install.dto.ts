import { IsNotEmpty, IsUUID, IsDateString } from 'class-validator';

export class ScheduleInstallDto {
    @IsUUID()
    @IsNotEmpty()
    installerId: string;

    @IsDateString()
    @IsNotEmpty()
    scheduledAt: string;
}