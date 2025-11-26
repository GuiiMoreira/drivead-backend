import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAdvertiserDto } from './dto/update-advertiser.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { Advertiser, User } from '@prisma/client';
import { CreateAdvertiserDto } from './dto/create-advertiser.dto';

@Injectable()
export class AdvertisersService {
  constructor(private prisma: PrismaService) {}

async createAdvertiser(user: User, dto: CreateAdvertiserDto) {
    // 1. Verifica se o usuário já tem uma empresa
    if (user.advertiserId) {
      throw new BadRequestException('Este usuário já pertence a uma empresa.');
    }

    // 2. Verifica se o CNPJ já existe
    const existingCnpj = await this.prisma.advertiser.findUnique({
      where: { cnpj: dto.cnpj },
    });
    if (existingCnpj) {
      throw new BadRequestException('CNPJ já cadastrado.');
    }

    // 3. Cria a Empresa e Atualiza o Usuário numa Transação
    return this.prisma.$transaction(async (tx) => {
      // Cria a empresa
      const newAdvertiser = await tx.advertiser.create({
        data: {
          type: dto.tipo_empresa,
          cnpj: dto.cnpj,
          razaoSocial: dto.razao_social,
          nomeFantasia: dto.nome_fantasia,
          segmento: dto.segmento,
          // Mapeamento do Endereço
          logradouro: dto.endereco.logradouro,
          numero: dto.endereco.numero,
          complemento: dto.endereco.complemento,
          bairro: dto.endereco.bairro,
          cidade: dto.endereco.cidade,
          estado: dto.endereco.estado,
          cep: dto.endereco.cep,
          // Configs
          budgetLimit: dto.limite_orcamento_mensal,
          isAgencyMode: dto.modo_agencia,
        },
      });

      // Atualiza o usuário atual para ser o ADMIN desta empresa
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          advertiserId: newAdvertiser.id,
          teamRole: AdvertiserRole.ADMINISTRADOR, // Cargo padrão do criador
          permissionLevel: PermissionLevel.ADMIN, // Permissão máxima
        },
      });

      return { advertiser: newAdvertiser, user: updatedUser };
    });
  }

  async getCampaigns(userId: string) {
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { userId },
    });

    if (!advertiser) {
      throw new NotFoundException('Advertiser not found.');
    }

    return this.prisma.campaign.findMany({
      where: { advertiserId: advertiser.id },
    });
  }

  async updateAdvertiser(
    userId: string,
    data: UpdateAdvertiserDto,
  ): Promise<Advertiser> {
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { userId },
    });

    if (!advertiser) {
      throw new NotFoundException('Advertiser not found.');
    }

    return this.prisma.advertiser.update({
      where: { id: advertiser.id },
      data,
    });
  }

  async inviteMember(adminUser: User, dto: InviteMemberDto) {
    // Verifica permissão
    if (adminUser.permissionLevel !== PermissionLevel.ADMIN) {
      throw new BadRequestException('Apenas administradores podem convidar membros.');
    }

    // Verifica se o usuário convidado já existe no sistema
    let user = await this.prisma.user.findUnique({
      where: { phone: dto.telefone },
    });

    if (!user) {
      // Se não existe, cria um pré-cadastro (Role padrão 'advertiser')
      user = await this.prisma.user.create({
        data: {
          phone: dto.telefone,
          name: dto.nome,
          role: 'advertiser', // Role do sistema
        },
      });
    }

    if (user.advertiserId) {
      throw new BadRequestException('Este usuário já pertence a outra empresa.');
    }

    // Vincula o usuário à empresa do admin
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        advertiserId: adminUser.advertiserId,
        teamRole: dto.cargo,
        permissionLevel: dto.permissao,
      },
    });
  }
}