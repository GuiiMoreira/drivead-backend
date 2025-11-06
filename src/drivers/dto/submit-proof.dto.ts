import { IsEnum, IsNotEmpty } from 'class-validator';
import { ProofType } from '@prisma/client';

export class SubmitProofDto {
    @IsEnum(ProofType)
    @IsNotEmpty()
    proofType: ProofType; // 'RANDOM' ou 'FINAL'
}