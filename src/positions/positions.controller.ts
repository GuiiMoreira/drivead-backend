import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PositionsService } from './positions.service';
import { CreatePositionsDto } from './dto/create-position.dto';
import { DriverGuard } from '../core/guards/driver.guard';
import { User } from '@prisma/client';

@Controller('positions')
@UseGuards(AuthGuard('jwt'), DriverGuard)
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Post()
  async create(@Req() req, @Body() createPositionDto: CreatePositionsDto) {
    const result = await this.positionsService.createPositions(
      req.user as User, 
      createPositionDto.positions
    );

    // Verificação de Tipo:
    // Se o resultado tiver uma propriedade 'message', significa que a operação
    // foi interrompida (fraude detetada ou outra regra de negócio).
    if (result && 'message' in result) {
        return {
            success: false,
            message: result.message, // Ex: "Atividade suspeita detectada..."
        };
    }

    // Caso contrário, é o sucesso padrão (BatchPayload) que tem o .count
    // Usamos 'as any' para simplificar a tipagem do Prisma no controller
    const count = result ? (result as any).count : 0;

    return {
      success: true,
      message: `${count} posições recebidas com sucesso.`,
    };
  }
}