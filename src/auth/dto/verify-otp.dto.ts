import { IsNotEmpty, IsPhoneNumber, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
    @IsNotEmpty({ message: 'O número de telemóvel não pode estar vazio.' })
    @IsPhoneNumber('BR', { message: 'Por favor, insira um número de telemóvel válido.' })
    phone: string;

    @IsNotEmpty({ message: 'O código OTP não pode estar vazio.' })
    @IsString()
    @Length(6, 6, { message: 'O código OTP deve ter 6 dígitos.' })
    otp: string;
}