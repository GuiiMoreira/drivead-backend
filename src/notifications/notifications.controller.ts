import { Controller, Post, Body, Get, Param, Patch, UseGuards, Req } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from '@nestjs/passport';
import { User } from '@prisma/client';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('token')
  async registerToken(@Req() req, @Body() body: { token: string }) {
    await this.notificationsService.registerDeviceToken((req.user as User).id, body.token);
    return { success: true };
  }

  @Get()
  async getNotifications(@Req() req) {
    const data = await this.notificationsService.getUserNotifications((req.user as User).id);
    return { success: true, data };
  }

  @Patch(':id/read')
  async markAsRead(@Req() req, @Param('id') id: string) {
    await this.notificationsService.markAsRead((req.user as User).id, id);
    return { success: true };
  }
}