import {
  Controller,
  Patch,
  Body,
  UseGuards,
  Req,
  Get,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdvertisersService } from './advertisers.service';
import { UpdateAdvertiserDto } from './dto/update-advertiser.dto';
import { User } from '@prisma/client';
import { AdvertiserGuard } from '../core/guards/advertiser.guard';

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
}