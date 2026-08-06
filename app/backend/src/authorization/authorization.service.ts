import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { MemberStatus, PermissionEffect, Prisma } from '@prisma/client';

import {
  isPermissionKey,
  reservedPermissionKeys,
  type AuthenticatedActor,
  type PermissionKey,
} from '@weave/types';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReauthenticationService } from '../auth/reauthentication.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { ReauthenticateDto } from './authorization.dto';
import { resolveEffectivePermissions } from './effective-permissions';

@Injectable()
export class AuthorizationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly reauthentication: ReauthenticationService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  public async resolveActor(
    userId: string,
    sessionId: string,
    workspaceId: number,
  ): Promise<AuthenticatedActor> {
    this.workspaces.assertDefault(workspaceId);
    const [systemAdmin, member] = await Promise.all([
      this.prisma.systemAdministrator.findUnique({
        where: { userId },
        select: { userId: true },
      }),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        include: {
          directPermissions: true,
          roles: { include: { role: { include: { permissions: true } } } },
        },
      }),
    ]);

    if (systemAdmin) {
      return {
        userId,
        workspaceId,
        sessionId,
        permissions: resolveEffectivePermissions({
          directPermissions: [],
          isSystemAdmin: true,
          isWorkspaceAdmin: false,
          rolePermissionKeys: [],
        }),
        isSystemAdmin: true,
        isWorkspaceAdmin: Boolean(member?.isWorkspaceAdmin),
      };
    }

    if (!member || member.status !== MemberStatus.active) {
      return {
        userId,
        workspaceId,
        sessionId,
        permissions: [],
        isSystemAdmin: false,
        isWorkspaceAdmin: false,
      };
    }

    if (member.isWorkspaceAdmin) {
      return {
        userId,
        workspaceId,
        sessionId,
        permissions: resolveEffectivePermissions({
          directPermissions: [],
          isSystemAdmin: false,
          isWorkspaceAdmin: true,
          rolePermissionKeys: [],
        }),
        isSystemAdmin: false,
        isWorkspaceAdmin: true,
      };
    }

    return {
      userId,
      workspaceId,
      sessionId,
      permissions: resolveEffectivePermissions({
        directPermissions: member.directPermissions,
        isSystemAdmin: false,
        isWorkspaceAdmin: false,
        rolePermissionKeys: member.roles.flatMap(({ role }) => (
          role.permissions.map(({ permissionKey }) => permissionKey)
        )),
      }),
      isSystemAdmin: false,
      isWorkspaceAdmin: false,
    };
  }

  public assertGrantKeys(keys: string[]): PermissionKey[] {
    const invalid = keys.find(
      (key) => !isPermissionKey(key) || reservedPermissionKeys.includes(key as never),
    );
    if (invalid) throw new BadRequestException(`Unknown or reserved permission: ${invalid}`);
    return [...new Set(keys)] as PermissionKey[];
  }

  public async replaceDirectPermissions(
    memberId: string,
    grants: Array<{ effect: 'allow' | 'deny'; permissionKey: string }>,
    actorUserId: string,
    workspaceId?: number,
  ): Promise<void> {
    if (workspaceId !== undefined) this.workspaces.assertDefault(workspaceId);
    this.assertGrantKeys(grants.map(({ permissionKey }) => permissionKey));
    const member = await this.prisma.workspaceMember.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Member not found');
    if (workspaceId !== undefined && member.workspaceId !== workspaceId) {
      throw new NotFoundException('Member not found');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.memberPermission.deleteMany({ where: { memberId } });
      await tx.memberPermission.createMany({
        data: grants.map((grant) => ({
          memberId,
          permissionKey: grant.permissionKey,
          effect: grant.effect as PermissionEffect,
          grantedByUserId: actorUserId,
        })),
      });
      await this.audit.record({
        action: 'member.permissions.replace',
        actorType: 'user',
        actorUserId,
        resourceType: 'workspace_member',
        resourceId: memberId,
        result: 'success',
        workspaceId: member.workspaceId,
        metadata: grants as unknown as Prisma.InputJsonValue,
      }, tx);
    });
  }

  public listRoles(workspaceId: number) {
    this.workspaces.assertDefault(workspaceId);
    return this.prisma.role.findMany({ where: { workspaceId }, include: { permissions: true } });
  }

  public async createRole(
    workspaceId: number,
    data: { code: string; description?: string; name: string },
    actorUserId: string,
  ) {
    this.workspaces.assertDefault(workspaceId);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { workspaceId, ...data } });
      await this.audit.record({
        action: 'role.create',
        actorType: 'user',
        actorUserId,
        resourceType: 'role',
        resourceId: role.id,
        result: 'success',
        workspaceId,
      }, tx);
      return role;
    });
  }

  public async updateRole(
    workspaceId: number,
    roleId: string,
    data: { description?: string; name?: string },
    actorUserId: string,
  ) {
    this.workspaces.assertDefault(workspaceId);
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.workspaceId !== workspaceId) throw new NotFoundException('Role not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({ where: { id: roleId }, data });
      await this.audit.record({
        action: 'role.update',
        actorType: 'user',
        actorUserId,
        resourceType: 'role',
        resourceId: roleId,
        result: 'success',
        workspaceId,
      }, tx);
      return updated;
    });
  }

  public async replaceRolePermissions(
    workspaceId: number,
    roleId: string,
    keys: string[],
    actorUserId: string,
  ): Promise<void> {
    this.workspaces.assertDefault(workspaceId);
    const permissionKeysToStore = this.assertGrantKeys(keys);
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.workspaceId !== workspaceId) throw new NotFoundException('Role not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: permissionKeysToStore.map((permissionKey) => ({ roleId, permissionKey })),
      });
      await this.audit.record({
        action: 'role.permissions.replace',
        actorType: 'user',
        actorUserId,
        resourceType: 'role',
        resourceId: roleId,
        result: 'success',
        workspaceId,
        metadata: { permissionKeys: permissionKeysToStore },
      }, tx);
    });
  }

  public async deleteRole(
    workspaceId: number,
    roleId: string,
    actorUserId: string,
  ): Promise<void> {
    this.workspaces.assertDefault(workspaceId);
    const [role, memberCount] = await Promise.all([
      this.prisma.role.findUnique({ where: { id: roleId } }),
      this.prisma.memberRole.count({ where: { roleId } }),
    ]);
    if (!role || role.workspaceId !== workspaceId) throw new NotFoundException('Role not found');
    if (role.isSystem || memberCount > 0) {
      throw new ConflictException('Assigned or system role cannot be deleted');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.record({
        action: 'role.delete',
        actorType: 'user',
        actorUserId,
        resourceType: 'role',
        resourceId: roleId,
        result: 'success',
        workspaceId,
      }, tx);
    });
  }

  public async replaceMemberRoles(
    workspaceId: number,
    memberId: string,
    roleIds: string[],
    actorUserId: string,
  ): Promise<void> {
    this.workspaces.assertDefault(workspaceId);
    const [member, roles] = await Promise.all([
      this.prisma.workspaceMember.findUnique({ where: { id: memberId } }),
      this.prisma.role.findMany({ where: { id: { in: roleIds }, workspaceId } }),
    ]);
    if (!member || member.workspaceId !== workspaceId || roles.length !== new Set(roleIds).size) {
      throw new BadRequestException('Member and roles must belong to the same Workspace');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.memberRole.deleteMany({ where: { memberId } });
      await tx.memberRole.createMany({
        data: [...new Set(roleIds)].map((roleId) => ({
          memberId,
          roleId,
          assignedByUserId: actorUserId,
        })),
      });
      await this.audit.record({
        action: 'member.roles.replace',
        actorType: 'user',
        actorUserId,
        resourceType: 'workspace_member',
        resourceId: memberId,
        result: 'success',
        workspaceId,
        metadata: { roleIds: [...new Set(roleIds)] },
      }, tx);
    });
  }

  public listSystemAdministrators() {
    return this.prisma.systemAdministrator.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            nickname: true,
          },
        },
      },
    });
  }

  public async setWorkspaceAdministrator(
    workspaceId: number,
    memberId: string,
    enabled: boolean,
    actorUserId: string,
    credential: ReauthenticateDto,
  ): Promise<void> {
    this.workspaces.assertDefault(workspaceId);
    await this.reauthentication.verify(actorUserId, credential);
    await this.prisma.$transaction(async (tx) => {
      const [member, workspace] = await Promise.all([
        tx.workspaceMember.findUnique({ where: { id: memberId } }),
        tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      ]);
      if (!member || member.workspaceId !== workspaceId) {
        throw new NotFoundException('Member not found');
      }
      if (enabled && member.status !== MemberStatus.active) {
        throw new BadRequestException('Only active members can become Workspace administrators');
      }
      if (!enabled && workspace.ownerUserId === member.userId) {
        throw new ConflictException('Workspace owner must remain a Workspace administrator');
      }
      await tx.workspaceMember.update({
        where: { id: memberId },
        data: { isWorkspaceAdmin: enabled },
      });
      await this.audit.record({
        action: `workspace_administrator.${enabled ? 'grant' : 'revoke'}`,
        actorType: 'user',
        actorUserId,
        resourceType: 'workspace_member',
        resourceId: memberId,
        result: 'success',
        workspaceId,
      }, tx);
    });
  }

  public async grantSystemAdministrator(
    userId: string,
    actorUserId: string,
    credential: ReauthenticateDto,
  ): Promise<void> {
    await this.reauthentication.verify(actorUserId, credential);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'active') {
      throw new BadRequestException('Only active users can become system administrators');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.systemAdministrator.upsert({
        where: { userId },
        create: { userId, grantedByUserId: actorUserId },
        update: {},
      });
      await this.audit.record({
        action: 'system_administrator.grant',
        actorType: 'user',
        actorUserId,
        resourceType: 'user',
        resourceId: userId,
        result: 'success',
      }, tx);
    });
  }

  public async revokeSystemAdministrator(
    userId: string,
    actorUserId: string,
    credential: ReauthenticateDto,
  ): Promise<void> {
    await this.reauthentication.verify(actorUserId, credential);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // Serializable retry must be sequential.
        // eslint-disable-next-line no-await-in-loop
        await this.prisma.$transaction(async (tx) => {
          const [target, activeCount] = await Promise.all([
            tx.systemAdministrator.findUnique({
              where: { userId },
              include: { user: { select: { status: true } } },
            }),
            tx.systemAdministrator.count({ where: { user: { status: 'active' } } }),
          ]);
          if (!target) throw new NotFoundException('System administrator not found');
          if (target.user.status === 'active' && activeCount <= 1) {
            throw new ConflictException('The last system administrator cannot be revoked');
          }
          await tx.systemAdministrator.delete({ where: { userId } });
          await this.audit.record({
            action: 'system_administrator.revoke',
            actorType: 'user',
            actorUserId,
            resourceType: 'user',
            resourceId: userId,
            result: 'success',
          }, tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return;
      } catch (error: unknown) {
        if (error instanceof ConflictException) {
          // A denied concurrent mutation is audited after its transaction rolls back.
          // eslint-disable-next-line no-await-in-loop
          await this.audit.record({
            action: 'system_administrator.revoke',
            actorType: 'user',
            actorUserId,
            resourceType: 'user',
            resourceId: userId,
            result: 'denied',
          });
          throw error;
        }
        const isRetryable = error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === 'P2034';
        if (!isRetryable || attempt === 2) throw error;
      }
    }
  }
}
