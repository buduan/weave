import {
  Body, Controller, Get, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedActor, MailPublicConfig } from '@orz-people-platform/types';

import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { MailService } from './mail.service';
import { UpdateMailConfigDto } from './mail.dto';

@Controller('mail')
@ApiTags('Mail')
@ApiBearerAuth()
export class MailController {
  public constructor(private readonly mail: MailService) {}

  @Get('config')
  @RequirePermissions('system_admin')
  public getConfig(): Promise<MailPublicConfig> {
    return this.mail.getPublicConfig();
  }

  @Put('config')
  @RequirePermissions('system_admin')
  public async updateConfig(
    @Body() dto: UpdateMailConfigDto,
      @CurrentActor() actor: AuthenticatedActor,
  ): Promise<MailPublicConfig> {
    await this.mail.updateConfig(dto.url, actor.userId);
    return this.mail.getPublicConfig();
  }
}
