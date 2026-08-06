/* eslint-disable max-classes-per-file */
import {
  describe, expect, it, vi,
} from 'vitest';

import { SessionService } from '../../src/auth/session.service';

class FakeSessionMulti {
  public constructor(private readonly redis: FakeSessionRedis) {}

  public set(key: string, value: string): this {
    this.redis.values.set(key, value);
    return this;
  }

  public sadd(key: string, value: string): this {
    const set = this.redis.sets.get(key) ?? new Set<string>();
    set.add(value);
    this.redis.sets.set(key, set);
    return this;
  }

  public expire(): this {
    return this;
  }

  public del(key: string): this {
    this.redis.values.delete(key);
    this.redis.sets.delete(key);
    return this;
  }

  public srem(key: string, value: string): this {
    this.redis.sets.get(key)?.delete(value);
    return this;
  }

  public async exec(): Promise<[]> {
    return [];
  }
}

class FakeSessionRedis {
  public readonly sets = new Map<string, Set<string>>();

  public readonly values = new Map<string, string>();

  public multi(): FakeSessionMulti {
    return new FakeSessionMulti(this);
  }

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async ttl(): Promise<number> {
    return 3600;
  }

  public async eval(
    _script: string,
    _keys: number,
    key: string,
    expected: string,
    next: string,
  ): Promise<'OK' | null> {
    if (this.values.get(key) !== expected) return null;
    this.values.set(key, next);
    return 'OK';
  }

  public async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
}

describe('Refresh Session rotation', () => {
  it('rotates a Refresh Token once and revokes the Session on replay', async () => {
    const redis = new FakeSessionRedis();
    const jwt = { sign: vi.fn(() => 'signed-access-token') };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ status: 'active', tokenVersion: 1 }),
      },
    };
    const service = new SessionService(
      redis as never,
      jwt as never,
      {
        accessTtlSeconds: 900,
        audience: 'test',
        issuer: 'test',
        jwtSecret: 'secret',
        refreshTtlSeconds: 3600,
      } as never,
      prisma as never,
      { record: vi.fn() } as never,
    );

    const first = await service.create('user-1', 1, 'test device');
    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect([...redis.values.values()].join('')).not.toContain(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toThrow('Invalid refresh token');
    expect(await service.list('user-1')).toEqual([]);
  });
});
