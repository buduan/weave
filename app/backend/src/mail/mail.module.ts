import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

@Module({
  imports: [AuditModule],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
