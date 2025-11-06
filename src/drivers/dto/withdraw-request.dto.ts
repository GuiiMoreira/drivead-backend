import { IsNotEmpty, IsNumber, IsPositive } from 'class-validator';

export class WithdrawRequestDto {
    @IsNumber()
    @IsPositive()
    @IsNotEmpty()
    amount: number;

    // No futuro, podemos adicionar aqui:
    // @IsString()
    // @IsNotEmpty()
    // pixKey: string;
}