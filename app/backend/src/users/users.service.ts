import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MemberStatus, Prisma, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

import { apiStatuses, type UserProfile } from '@weave/types';
import { validatePassword } from '@weave/utils';

import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { ensureWorkspaceMemberSampleData } from '../workspaces/workspace-member-sample-data';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateUserDto, UpdateProfileDto } from './users.dto';

const safeUserSelect = {
  id: true,
  email: true,
  username: true,
  name: true,
  nickname: true,
  avatarUrl: true,
  phone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  public async findSafeById(id: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: safeUserSelect });
    if (!user) throw new NotFoundException('User not found');
    return this.toProfile(user);
  }

  public async list(): Promise<UserProfile[]> {
    const users = await this.prisma.user.findMany({
      select: safeUserSelect,
      orderBy: { createdAt: 'desc' },
    });
    return users.map((user) => this.toProfile(user));
  }

  public async create(dto: CreateUserDto, actorUserId?: string): Promise<UserProfile> {
    if (dto.password && !validatePassword(dto.password).valid) {
      throw new ConflictException('Password does not meet policy');
    }
    const passwordHash = dto.password
      ? await argon2.hash(dto.password, { type: argon2.argon2id })
      : null;
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: dto.email,
            username: dto.username,
            name: dto.name,
            nickname: dto.nickname,
            passwordHash,
            passwordUpdatedAt: passwordHash ? new Date() : null,
          },
          select: safeUserSelect,
        });
        const workspaceId = WorkspacesService.DEFAULT_ID;
        const role = await tx.role.findFirstOrThrow({
          where: { workspaceId, isDefault: true },
        });
        const guestType = await tx.workspaceMemberType.findUniqueOrThrow({
          where: { workspaceId_slug: { workspaceId, slug: 'guest' } },
        });
        const member = await tx.workspaceMember.create({
          data: {
            workspaceId,
            userId: created.id,
            memberTypeId: guestType.id,
            status: MemberStatus.pending,
          },
        });
        await tx.memberRole.create({
          data: {
            memberId: member.id,
            roleId: role.id,
            assignedByUserId: actorUserId ?? created.id,
          },
        });
        await this.audit.record({
          action: 'user.create',
          actorType: actorUserId ? 'user' : 'system',
          actorUserId,
          resourceType: 'user',
          resourceId: created.id,
          result: 'success',
          workspaceId,
        }, tx);
        return created;
      });
      return this.toProfile(user);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email, username or phone already exists');
      }
      throw error;
    }
  }

  public async registerVerified(input: {
    email: string;
    name: string;
    username: string;
  }): Promise<{ id: string; tokenVersion: number }> {
    try {
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const created = await tx.user.create({
          data: {
            email: input.email,
            username: input.username,
            name: input.name,
            nickname: input.name,
            emailVerifiedAt: now,
            status: UserStatus.active,
          },
          select: { id: true, tokenVersion: true },
        });
        const workspaceId = WorkspacesService.DEFAULT_ID;
        const [role, guestType] = await Promise.all([
          tx.role.findFirstOrThrow({ where: { workspaceId, isDefault: true } }),
          tx.workspaceMemberType.findUniqueOrThrow({
            where: { workspaceId_slug: { workspaceId, slug: 'guest' } },
          }),
        ]);
        const member = await tx.workspaceMember.create({
          data: {
            workspaceId,
            userId: created.id,
            memberTypeId: guestType.id,
            status: MemberStatus.active,
            joinedAt: now,
          },
        });
        await tx.memberRole.create({
          data: {
            memberId: member.id,
            roleId: role.id,
            assignedByUserId: created.id,
          },
        });
        const sampleData = await ensureWorkspaceMemberSampleData(tx, {
          workspaceId,
          workspaceMemberId: member.id,
          userId: created.id,
        });
        await this.audit.record({
          action: 'user.registration.complete',
          actorType: 'system',
          resourceType: 'user',
          resourceId: created.id,
          result: 'success',
          workspaceId,
          metadata: {
            sampleData: {
              created: sampleData.created,
              datasetId: sampleData.datasetId,
              formId: sampleData.formId,
            },
          },
        }, tx);
        return created;
      });
      return transactionResult;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
        if (target.includes('username')) {
          throw new ConflictException({
            status: apiStatuses.usernameUnavailable,
            message: 'Username is unavailable',
          });
        }
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  public async updateProfile(id: string, dto: UpdateProfileDto): Promise<UserProfile> {
    const user = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: safeUserSelect,
    });
    return this.toProfile(user);
  }

  public async updateStatus(
    id: string,
    status: UserStatus,
    actorUserId: string,
  ): Promise<UserProfile> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // Serializable retry must be sequential.
        // eslint-disable-next-line no-await-in-loop
        const user = await this.prisma.$transaction(async (tx) => {
          if (status === UserStatus.disabled) {
            const isSystemAdministrator = await tx.systemAdministrator.findUnique({
              where: { userId: id },
            });
            if (isSystemAdministrator) {
              const activeAdministrators = await tx.systemAdministrator.count({
                where: { user: { status: UserStatus.active, deletedAt: null } },
              });
              if (activeAdministrators <= 1) {
                throw new ConflictException(
                  'The last active system administrator cannot be disabled',
                );
              }
            }
          }
          const updated = await tx.user.update({
            where: { id },
            data: {
              status,
              tokenVersion: { increment: 1 },
              deletedAt: status === UserStatus.disabled ? new Date() : null,
            },
            select: safeUserSelect,
          });
          await this.audit.record({
            action: 'user.status.update',
            actorType: 'user',
            actorUserId,
            resourceType: 'user',
            resourceId: id,
            result: 'success',
            metadata: { status },
          }, tx);
          return updated;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        // A successful database mutation must revoke Redis sessions before returning.
        // eslint-disable-next-line no-await-in-loop
        await this.sessions.revokeAll(id);
        return this.toProfile(user);
      } catch (error: unknown) {
        if (error instanceof ConflictException) throw error;
        const isRetryable = error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === 'P2034';
        if (!isRetryable || attempt === 2) {
          throw error;
        }
      }
    }
    throw new ConflictException('Could not update user status');
  }

  public async forceLogout(id: string, actorUserId: string): Promise<void> {
    await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { id: true } });
    await this.sessions.revokeAll(id);
    await this.audit.record({
      action: 'user.sessions.revoke_all',
      actorType: 'user',
      actorUserId,
      resourceType: 'user',
      resourceId: id,
      result: 'success',
    });
  }

  private toProfile(user: Prisma.UserGetPayload<{ select: typeof safeUserSelect }>): UserProfile {
    return {
      ...user,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
