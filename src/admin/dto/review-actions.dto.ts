import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class ReviewProofDto {
  @IsBoolean({ message: 'O campo approved deve ser um booleano (true ou false).' })
  approved: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReviewAdvertiserDto {
  @IsIn(['approve', 'reject'], { message: 'A ação deve ser "approve" ou "reject".' })
  action: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ReviewCampaignDto {
  @IsIn(['approve', 'reject'], { message: 'A ação deve ser "approve" ou "reject".' })
  action: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ResolveFraudDto {
  @IsIn(['dismiss', 'penalize'], { message: 'A ação deve ser "dismiss" ou "penalize".' })
  action: 'dismiss' | 'penalize';

  @IsOptional()
  @IsString()
  notes?: string;
}