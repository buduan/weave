import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { MailPublicConfig } from '@orz-people-platform/types';

import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';

/**
 * Power Automate 邮件发送入参。Power Automate schema 的 payload 为
 * `{ email, subject, content }`。
 */
export interface SendMailInput {
  to: string;
  subject: string;
  content: string;
}

const WEBHOOK_URL_KEY = 'settings:email:power-automate:webhook-url';

@Injectable()
export class MailService {
  public constructor(
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  /** 读取当前配置的 webhook URL，未配置时返回 null。 */
  public async getWebhookUrl(): Promise<string | null> {
    const url = await this.redis.get(WEBHOOK_URL_KEY);
    return url && url.trim() ? url.trim() : null;
  }

  /** 写入（或清空）webhook URL。空字符串会删除 key，停用邮件发送。 */
  public async setWebhookUrl(url: string): Promise<void> {
    const trimmed = url.trim();
    if (trimmed) {
      await this.redis.set(WEBHOOK_URL_KEY, trimmed);
    } else {
      await this.redis.del(WEBHOOK_URL_KEY);
    }
  }

  /** 更新 webhook 配置并审计（空字符串清空配置）。 */
  public async updateConfig(url: string, actorUserId: string): Promise<void> {
    await this.setWebhookUrl(url);
    await this.audit.record({
      action: 'mail.config.update',
      actorType: 'user',
      actorUserId,
      resourceType: 'mail_config',
      resourceId: 'power_automate',
      result: 'success',
    });
  }

  /** 返回给前端的公共配置，永不暴露密钥。 */
  public async getPublicConfig(): Promise<MailPublicConfig> {
    const url = await this.getWebhookUrl();
    return { configured: Boolean(url), url: url ?? '' };
  }

  /**
   * 通过 Power Automate webhook 发送邮件。未配置 URL 或远端返回非 2xx 时抛错，
   * 由调用方决定是否吞掉。返回合成 messageId 供审计/日志引用。
   */
  public async send(input: SendMailInput): Promise<string> {
    const url = await this.getWebhookUrl();
    if (!url) throw new Error('Power Automate webhook URL is not configured');
    const payload = { email: input.to, subject: input.subject, content: input.content };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Webhook returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    return `<pa-${randomBytes(8).toString('hex')}@webhook>`;
  }
}
