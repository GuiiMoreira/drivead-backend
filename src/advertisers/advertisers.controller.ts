import {
  Controller,
  Patch,
  Body,
  UseGuards,
  Req,
  Get,
  Post,
  UseInterceptors,
  UploadedFiles,
  BadRequestException
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AdvertisersService } from './advertisers.service';
import { UpdateAdvertiserDto } from './dto/update-advertiser.dto';
import { User } from '@prisma/client';
import { AdvertiserGuard } from '../core/guards/advertiser.guard';
import { CreateAdvertiserDto } from './dto/create-advertiser.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

@Controller('advertisers')
export class AdvertisersController {
  constructor(private readonly advertisersService: AdvertisersService) {}

  @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
  @Get('me/campaigns')
  async getCampaigns(@Req() req) {
    const user = req.user as User;
    const campaigns = await this.advertisersService.getCampaigns(user.id);
    return {
      success: true,
      data: campaigns,
    };
  }

  @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
  @Patch('me')
  async updateAdvertiser(
    @Req() req,
    @Body() updateAdvertiserDto: UpdateAdvertiserDto,
  ) {
    const user = req.user as User;
    const updatedAdvertiser = await this.advertisersService.updateAdvertiser(
      user.id,
      updateAdvertiserDto,
    );
    return {
      success: true,
      data: updatedAdvertiser,
    };
  }

  // --- CORREÇÃO: Endpoint preparado para receber arquivos via FormData ---
  @Post()
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'docCnpj', maxCount: 1 },
    { name: 'docContrato', maxCount: 1 },
    { name: 'docResponsavel', maxCount: 1 },
  ]))
  async create(
    @Req() req, 
    @Body() body: any, 
    @UploadedFiles() files: { 
      docCnpj?: Express.Multer.File[], 
      docContrato?: Express.Multer.File[], 
      docResponsavel?: Express.Multer.File[] 
    }
  ) {
    let dto: CreateAdvertiserDto;
    
    // Tratativa: Se o front enviar os dados dentro de um JSON stringificado na key 'data' (comum em FormData)
    if (body.data && typeof body.data === 'string') {
      try {
        dto = JSON.parse(body.data);
      } catch (e) {
        throw new BadRequestException('Formato de dados inválido. Envie um JSON válido no campo "data".');
      }
    } else {
      // Se o front enviar os campos soltos
      dto = body as CreateAdvertiserDto;
    }

    const result = await this.advertisersService.createAdvertiser(req.user as User, dto, files);

    return {
      success: true,
      message: 'Empresa cadastrada e documentos enviados com sucesso.',
      data: result
    };
  }

  @Post('members/invite')
  @UseGuards(AuthGuard('jwt'))
  invite(@Req() req, @Body() dto: InviteMemberDto) {
    return this.advertisersService.inviteMember(req.user as User, dto);
  }

  @Get('me/dashboard-summary')
  @UseGuards(AuthGuard('jwt'))
  getDashboard(@Req() req) {
    return this.advertisersService.getDashboardSummary(req.user as User);
  }


    @Get('me/invoices')
  @UseGuards(AuthGuard('jwt'), AdvertiserGuard)
  async getInvoices(@Req() req) {
    const user = req.user as User;
    const invoices = await this.advertisersService.getInvoices(user);
    
    return {
      success: true,
      data: invoices,
    };
  }
}