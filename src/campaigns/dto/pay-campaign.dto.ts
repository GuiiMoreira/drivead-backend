import { IsNotEmpty, IsString } from 'class-validator';

export class PayCampaignDto {
    @IsString()
    @IsNotEmpty()
    method: string; // Ex: 'pix', 'credit_card'
}