import {
  Body, BadGatewayException, Controller, Get, Post, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedActor, MailPublicConfig, MailTestResult } from '@orz-people-platform/types';

import { AuditService } from '../audit/audit.service';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { MailService } from './mail.service';
import { SendTestMailDto, UpdateMailConfigDto } from './mail.dto';

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

  @Post('test')
  @RequirePermissions('system_admin')
  public async sendTest(
    @Body() dto: SendTestMailDto,
      @CurrentActor() actor: AuthenticatedActor,
  ): Promise<MailTestResult> {
    try {
      const messageId = await this.mail.send({
        to: dto.to,
        subject: 'Weave mail test',
        content: 'This is a test email sent by the Weave Power Automate mail integration. '
          + 'If you received it, your settings are working correctly.',
      });
      return { messageId };
    } catch (error: unknown) {
      await this.audit.record({
        action: 'mail.test',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'mail_config',
        resourceId: 'power_automate',
        result: 'failure',
      });
      throw new BadGatewayException(error instanceof Error ? error.message : 'Failed to send test email');
    }
  }
}
