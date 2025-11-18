import { Controller, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from '@prisma/client';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(AuthGuard('jwt'))
  @Patch('me')
  async updateUser(@Req() req, @Body() updateUserDto: UpdateUserDto) {
    const user = req.user as User;
    const updatedUser = await this.usersService.updateUser(user.id, updateUserDto);
    return {
      success: true,
      data: updatedUser,
    };
  }
}