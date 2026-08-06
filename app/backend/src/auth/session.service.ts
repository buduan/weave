import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';

import type { AuthTokens } from '@weave/types';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuthSettingsService } from './auth-settings.service';

export interface SessionRecord {
  createdAt: string;
  deviceName?: string;
  expiresAt: string;
  refreshHash: string;
  tokenVersion: number;
  userId: string;
}

@Injectable()
export class SessionService {
  public constructor(
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly settings: AuthSettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  public async create(
    userId: string,
    tokenVersion: number,
    deviceName?: string,
  ): Promise<AuthTokens> {
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const now = new Date();
    const record: SessionRecord = {
      userId,
      tokenVersion,
      refreshHash: this.hash(secret),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.settings.refreshTtlSeconds * 1000).toISOString(),
      ...(deviceName ? { deviceName } : {}),
    };
    await this.redis.multi()
      .set(this.sessionKey(sessionId), JSON.stringify(record), 'EX', this.settings.refreshTtlSeconds)
      .sadd(this.userSessionsKey(userId), sessionId)
      .expire(this.userSessionsKey(userId), this.settings.refreshTtlSeconds)
      .exec();
    return this.tokens(sessionId, secret, record);
  }

  public async get(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.redis.get(this.sessionKey(sessionId));
    return raw ? JSON.parse(raw) as SessionRecord : null;
  }

  public async refresh(refreshToken: string): Promise<AuthTokens> {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret) throw new UnauthorizedException('Invalid refresh token');
    const record = await this.get(sessionId);
    if (!record || record.refreshHash !== this.hash(secret)) {
      if (record) await this.revoke(sessionId, record.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: { status: true, tokenVersion: true },
    });
    if (!user || user.status !== UserStatus.active || user.tokenVersion !== record.tokenVersion) {
      await this.revoke(sessionId, record.userId);
      throw new UnauthorizedException('Session is no longer valid');
    }
    const nextSecret = randomBytes(32).toString('base64url');
    record.refreshHash = this.hash(nextSecret);
    const ttl = await this.redis.ttl(this.sessionKey(sessionId));
    if (ttl <= 0) throw new UnauthorizedException('Expired refresh token');
    const rotateScript = [
      'if redis.call(\'GET\', KEYS[1]) == ARGV[1] then',
      'return redis.call(\'SET\', KEYS[1], ARGV[2], \'EX\', ARGV[3])',
      'else return nil end',
    ].join(' ');
    const result = await this.redis.eval(
      rotateScript,
      1,
      this.sessionKey(sessionId),
      JSON.stringify({ ...record, refreshHash: this.hash(secret) }),
      JSON.stringify(record),
      ttl,
    );
    if (!result) {
      await this.revoke(sessionId, record.userId);
      throw new UnauthorizedException('Refresh token replay detected');
    }
    return this.tokens(sessionId, nextSecret, record);
  }

  public async revoke(sessionId: string, userId: string): Promise<void> {
    await this.redis.multi()
      .del(this.sessionKey(sessionId))
      .srem(this.userSessionsKey(userId), sessionId)
      .exec();
  }

  public async revokeAll(userId: string): Promise<void> {
    const key = this.userSessionsKey(userId);
    const sessionIds = await this.redis.smembers(key);
    const transaction = this.redis.multi();
    sessionIds.forEach((sessionId) => transaction.del(this.sessionKey(sessionId)));
    transaction.del(key);
    await transaction.exec();
  }

  /** 用户主动登出：吊销会话并审计。内部的 security revoke（refresh 轮换失败等）仍走 revoke，不审计。 */
  public async logout(sessionId: string, userId: string): Promise<void> {
    await this.revoke(sessionId, userId);
    await this.audit.record({
      action: 'session.revoke',
      actorType: 'user',
      actorUserId: userId,
      resourceType: 'session',
      resourceId: sessionId,
      result: 'success',
    });
  }

  /** 用户主动登出所有会话：吊销并审计。 */
  public async logoutAll(userId: string): Promise<void> {
    await this.revokeAll(userId);
    await this.audit.record({
      action: 'session.revoke_all',
      actorType: 'user',
      actorUserId: userId,
      resourceType: 'user',
      resourceId: userId,
      result: 'success',
    });
  }

  public async list(userId: string): Promise<Array<{
    id: string;
    createdAt: string;
    deviceName?: string;
    expiresAt: string;
  }>> {
    const ids = await this.redis.smembers(this.userSessionsKey(userId));
    const records = await Promise.all(ids.map(async (id) => ({ id, record: await this.get(id) })));
    return records.flatMap(({ id, record }) => (record ? [{
      id,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      ...(record.deviceName ? { deviceName: record.deviceName } : {}),
    }] : []));
  }

  private tokens(sessionId: string, secret: string, record: SessionRecord): AuthTokens {
    return {
      accessToken: this.jwt.sign(
        {
          sub: record.userId,
          sid: sessionId,
          jti: randomUUID(),
          typ: 'access',
          ver: record.tokenVersion,
        },
        {
          audience: this.settings.audience,
          issuer: this.settings.issuer,
          expiresIn: this.settings.accessTtlSeconds,
          secret: this.settings.jwtSecret,
        },
      ),
      refreshToken: `${sessionId}.${secret}`,
      accessTokenExpiresIn: this.settings.accessTtlSeconds,
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private sessionKey(sessionId: string): string {
    return `auth:session:${sessionId}`;
  }

  private userSessionsKey(userId: string): string {
    return `auth:user-sessions:${userId}`;
  }
}
