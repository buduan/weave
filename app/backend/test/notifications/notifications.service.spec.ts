import {
  describe, expect, it, vi,
} from 'vitest';

import type { MailService } from '../../src/mail/mail.service';
import { NotificationsService } from '../../src/notifications/notifications.service';

describe('notifications', () => {
  it('sends email codes via the mail channel without logging them', async () => {
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const mail = { send: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationsService(mail as unknown as MailService);

    await expect(service.sendEmailVerificationCode('user@example.com', '123456'))
      .resolves.toBeUndefined();
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: expect.any(String),
    }));
    // The code travels only inside the mail payload, never to logs.
    const sent = mail.send.mock.calls[0]?.[0] as { content: string } | undefined;
    expect(sent?.content).toContain('123456');

    // SMS remains a mock and never reaches the mail channel.
    await expect(service.sendSmsVerificationCode('+8613812345678', '654321'))
      .resolves.toBeUndefined();
    expect(mail.send).toHaveBeenCalledTimes(1);

    logs.forEach((logger) => expect(logger).not.toHaveBeenCalled());
    logs.forEach((logger) => logger.mockRestore());
  });

  it('swallows mail delivery failures so the OTP flow still succeeds', async () => {
    const mail = { send: vi.fn().mockRejectedValue(new Error('boom')) };
    const service = new NotificationsService(mail as unknown as MailService);

    await expect(service.sendEmailVerificationCode('user@example.com', '123456'))
      .resolves.toBeUndefined();
  });

  it('is a no-op when no mail service is wired', async () => {
    const service = new NotificationsService();

    await expect(service.sendEmailVerificationCode('user@example.com', '123456'))
      .resolves.toBeUndefined();
    await expect(service.sendSmsVerificationCode('+8613812345678', '654321'))
      .resolves.toBeUndefined();
  });
});
