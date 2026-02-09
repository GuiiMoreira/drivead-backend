import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PositionsService } from './positions.service';
import { CreatePositionBatchDto } from './dto/create-position.dto'; // Import atualizado
import { DriverGuard } from '../core/guards/driver.guard';
import { User } from '@prisma/client';

@Controller('positions')
@UseGuards(AuthGuard('jwt'), DriverGuard)
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  // Alterado para 'batch' para seguir a recomendação da análise (Item 2.3)
  // Rota Final: POST /api/v1/positions/batch
  @Post('batch')
  @HttpCode(HttpStatus.OK) // Retorna 200 OK em vez de 201 Created (padrão para batch process)
  async createBatch(@Req() req, @Body() batchDto: CreatePositionBatchDto) {
    const result = await this.positionsService.createPositions(
      req.user as User, 
      batchDto.positions
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