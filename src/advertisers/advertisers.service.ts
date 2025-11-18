import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAdvertiserDto } from './dto/update-advertiser.dto';
import { Advertiser, User } from '@prisma/client';
import { CreateAdvertiserDto } from './dto/create-advertiser.dto';

@Injectable()
export class AdvertisersService {
  constructor(private prisma: PrismaService) {}

  async createAdvertiser(userId: string, data: CreateAdvertiserDto) {
    const existingAdvertiser = await this.prisma.advertiser.findUnique({
      where: { userId },
    });

    if (existingAdvertiser) {
      throw new ConflictException('Advertiser profile already exists.');
    }

    return this.prisma.advertiser.create({
      data: {
        ...data,
        user: {
          connect: { id: userId },
        },
      },
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
}