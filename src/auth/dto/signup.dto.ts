import { IsNotEmpty, IsPhoneNumber } from 'class-validator';

export class SignUpDto {
    @IsNotEmpty({ message: 'O número de telemóvel não pode estar vazio.' })
    @IsPhoneNumber('BR', { message: 'Por favor, insira um número de telemóvel válido.' })
    phone: string;
}