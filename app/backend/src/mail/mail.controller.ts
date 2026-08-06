import {
  Body, Controller, Get, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedActor, MailPublicConfig } from '@orz-people-platform/types';

import { AuditService } from '../audit/audit.service';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { MailService } from './mail.service';
import { UpdateMailConfigDto } from './mail.dto';

@Controller('mail')
@ApiTags('Mail')
@ApiBearerAuth()
export class MailController {
  public constructor(
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) { }

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
    await this.mail.setWebhookUrl(dto.url);
    await this.audit.record({
      action: 'mail.config.update',
      actorType: 'user',
      actorUserId: actor.userId,
      resourceType: 'mail_config',
      resourceId: 'power_automate',
      result: 'success',
    });
    return this.mail.getPublicConfig();
  }
}
