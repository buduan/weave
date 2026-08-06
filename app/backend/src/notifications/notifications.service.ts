import { Injectable, Optional } from '@nestjs/common';

import { MailService } from '../mail/mail.service';

@Injectable()
export class NotificationsService {
  public constructor(@Optional() private readonly mail?: MailService) {}

  /**
   * 通过 Power Automate webhook 发送邮箱验证码。
   *
   * 发送失败被刻意吞掉：验证码生成与存储必须独立于邮件投递成功，
   * 邮件通道故障不应让认证流程返回 5xx。错误不写入日志，避免泄露验证码或 PII；
   * 邮件是否送达取决于 Redis 中配置的 webhook URL。
   */
  public async sendEmailVerificationCode(email: string, code: string): Promise<void> {
    if (!this.mail) return;
    try {
      await this.mail.send({
        to: email,
        subject: '您的验证码',
        content: `您的验证码是 ${code}。如非本人操作，请忽略此邮件。`,
      });
    } catch {
      // Intentionally swallowed: see method doc.
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async sendSmsVerificationCode(phone: string, code: string): Promise<void> {
    // Mock only: replace with a real SMS provider before enabling SMS delivery in production.
  }
}
