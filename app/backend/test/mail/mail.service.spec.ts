import {
  describe, expect, it, vi,
} from 'vitest';

import { MailService } from '../../src/mail/mail.service';
import type { RedisService } from '../../src/redis/redis.service';

const WEBHOOK_KEY = 'settings:email:power-automate:webhook-url';

function createRedisMock(): Pick<RedisService, 'get' | 'set' | 'del'> {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };
}

describe('MailService', () => {
  it('reads and trims a configured webhook url', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue('  https://example/hook  ');
    const service = new MailService(redis as RedisService, { record: vi.fn() } as never);

    await expect(service.getWebhookUrl()).resolves.toBe('https://example/hook');
    expect(redis.get).toHaveBeenCalledWith(WEBHOOK_KEY);
  });

  it('reports null when the url is missing or blank', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue('   ');
    const service = new MailService(redis as RedisService, { record: vi.fn() } as never);

    await expect(service.getWebhookUrl()).resolves.toBeNull();
  });

  it('stores a trimmed url and deletes the key when blank', async () => {
    const redis = createRedisMock();
    const service = new MailService(redis as RedisService, { record: vi.fn() } as never);

    await service.setWebhookUrl('  https://example/hook  ');
    expect(redis.set).toHaveBeenCalledWith(WEBHOOK_KEY, 'https://example/hook');

    await service.setWebhookUrl('   ');
    expect(redis.del).toHaveBeenCalledWith(WEBHOOK_KEY);
  });

  it('exposes a public config that mirrors configured state', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue('https://example/hook');
    const service = new MailService(redis as RedisService, { record: vi.fn() } as never);

    await expect(service.getPublicConfig()).resolves.toEqual({
      configured: true,
      url: 'https://example/hook',
    });
  });

  it('posts the power automate payload to the configured url', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue('https://example/hook');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const service = new MailService(redis as RedisService, { record: vi.fn() } as never);

    const messageId = await service.send({ to: 'a@b.com', subject: 'S', content: 'C' });

    expect(fetchMock).toHaveBeenCalledWith('https://example/hook', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', subject: 'S', content: 'C' }),
    }));
    expect(messageId).toMatch(/^<pa-[0-9a-f]+@webhook>$/);
    fetchMock.mockRestore();
  });

  it('throws when no url is configured', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue(null);
    const service = new MailService(redis as RedisService, { record: vi.fn() } as never);

    await expect(service.send({ to: 'a@b.com', subject: 'S', content: 'C' }))
      .rejects.toThrow('not configured');
  });

  it('throws when the webhook returns a non-ok response', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue('https://example/hook');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('bad', { status: 500 }));
    const service = new MailService(redis as RedisService, { record: vi.fn() } as never);

    await expect(service.send({ to: 'a@b.com', subject: 'S', content: 'C' }))
      .rejects.toThrow('Webhook returned 500');
    fetchMock.mockRestore();
  });

  it('updateConfig writes the url and audits the change', async () => {
    const redis = createRedisMock();
    const audit = { record: vi.fn() };
    const service = new MailService(redis as RedisService, audit as never);

    await service.updateConfig('  https://example/hook  ', 'user-1');

    expect(redis.set).toHaveBeenCalledWith(WEBHOOK_KEY, 'https://example/hook');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mail.config.update',
      actorType: 'user',
      actorUserId: 'user-1',
      result: 'success',
    }));
  });
});
