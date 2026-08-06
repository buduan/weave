import {
  Body, Controller, Delete, Get, Param, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedActor } from '@weave/types';

import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { CreateUserDto, UpdateProfileDto, UpdateUserStatusDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('user')
@ApiTags('Users')
@ApiBearerAuth()
export class UsersController {
  public constructor(private readonly users: UsersService) {}

  @Get('me')
  public me(@CurrentActor() actor: AuthenticatedActor) {
    return this.users.findOwnProfile(actor.userId);
  }

  @Patch('me')
  public updateMe(@CurrentActor() actor: AuthenticatedActor, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(actor.userId, dto);
  }

  @Get()
  @RequirePermissions('user.read')
  public list() {
    return this.users.list();
  }

  @Post()
  @RequirePermissions('user.create')
  public create(@CurrentActor() actor: AuthenticatedActor, @Body() dto: CreateUserDto) {
    return this.users.create(dto, actor.userId);
  }

  @Get(':id')
  @RequirePermissions('user.read')
  public get(@Param('id') id: string) {
    return this.users.findSafeById(id);
  }

  @Patch(':id/status')
  @RequirePermissions('user.disable')
  public updateStatus(
  @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.users.updateStatus(id, dto.status, actor.userId);
  }

  @Delete(':id/sessions')
  @RequirePermissions('user.disable')
  public async forceLogout(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor) {
    await this.users.forceLogout(id, actor.userId);
    return { accepted: true };
  }
}
