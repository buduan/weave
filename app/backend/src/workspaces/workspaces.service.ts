import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemberStatus, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MembersSyncService } from '../datasets/members-sync.service';
import { ensureWorkspaceMemberSampleData } from './workspace-member-sample-data';

@Injectable()
export class WorkspacesService {
  public static readonly DEFAULT_ID = 1;

  private static readonly systemMemberTypeSlugs = ['member', 'guest'];

  public constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly membersSync: MembersSyncService,
    private readonly audit: AuditService,
  ) {
    const configuredId = Number(config.get('DEFAULT_WORKSPACE_ID') ?? WorkspacesService.DEFAULT_ID);
    if (configuredId !== WorkspacesService.DEFAULT_ID) {
      throw new Error('DEFAULT_WORKSPACE_ID must be 1 for the first release');
    }
  }

  public assertDefault(workspaceId: number): void {
    if (workspaceId !== WorkspacesService.DEFAULT_ID) {
      throw new BadRequestException('Only the default Workspace is available');
    }
  }

  public async findDefault() {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: WorkspacesService.DEFAULT_ID },
    });
    if (!workspace) throw new NotFoundException('Default Workspace is not initialized');
    return workspace;
  }

  public async listMembers(workspaceId: number) {
    this.assertDefault(workspaceId);
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        memberType: true,
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            name: true,
            nickname: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async updateMember(
    workspaceId: number,
    memberId: string,
    data: { memberTypeId?: string; status?: MemberStatus },
    actorUserId: string,
  ) {
    this.assertDefault(workspaceId);
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findUnique({ where: { id: memberId } });
      if (!member || member.workspaceId !== workspaceId) throw new NotFoundException('Member not found');
      if (data.memberTypeId) {
        const memberType = await tx.workspaceMemberType.findUnique({
          where: { id: data.memberTypeId },
        });
        if (!memberType || memberType.workspaceId !== workspaceId) {
          throw new NotFoundException('Member type not found');
        }
      }
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      if (workspace.ownerUserId === member.userId
        && data.status
        && data.status !== MemberStatus.active) {
        throw new BadRequestException('Workspace owner must remain an active Workspace administrator');
      }
      const updated = await tx.workspaceMember.update({ where: { id: memberId }, data });
      const sampleData = member.status === MemberStatus.pending
        && data.status === MemberStatus.active
        ? await ensureWorkspaceMemberSampleData(tx, {
          workspaceId,
          workspaceMemberId: member.id,
          userId: member.userId,
        })
        : undefined;
      if (data.memberTypeId !== undefined || data.status !== undefined) {
        await this.membersSync.synchronize(tx, workspaceId, memberId, actorUserId);
      }
      await this.audit.record({
        action: 'workspace.member.update',
        actorType: 'user',
        actorUserId,
        resourceType: 'workspace_member',
        resourceId: memberId,
        result: 'success',
        workspaceId,
        metadata: {
          ...data,
          ...(sampleData ? {
            sampleData: {
              created: sampleData.created,
              datasetId: sampleData.datasetId,
              formId: sampleData.formId,
            },
          } : {}),
        } as Prisma.InputJsonObject,
      }, tx);
      return updated;
    });
  }

  public listMemberTypes(workspaceId: number) {
    this.assertDefault(workspaceId);
    return this.prisma.workspaceMemberType.findMany({
      where: { workspaceId },
      orderBy: [{ isSystem: 'desc' }, { slug: 'asc' }],
    });
  }

  public async createMemberType(
    workspaceId: number,
    data: { name: string; slug: string },
    actorUserId: string,
  ) {
    this.assertDefault(workspaceId);
    this.assertCustomSlug(data.slug);
    return this.prisma.$transaction(async (tx) => {
      const memberType = await tx.workspaceMemberType.create({ data: { workspaceId, ...data } });
      await this.audit.record({
        action: 'workspace.member_type.create',
        actorType: 'user',
        actorUserId,
        resourceType: 'workspace_member_type',
        resourceId: memberType.id,
        result: 'success',
        workspaceId,
        metadata: data,
      }, tx);
      return memberType;
    });
  }

  public async updateMemberType(
    workspaceId: number,
    memberTypeId: string,
    data: { name?: string; slug?: string },
    actorUserId: string,
  ) {
    this.assertDefault(workspaceId);
    const memberType = await this.findMemberType(workspaceId, memberTypeId);
    if (memberType.isSystem && data.slug && data.slug !== memberType.slug) {
      throw new BadRequestException('System member type slugs cannot be changed');
    }
    if (!memberType.isSystem && data.slug) this.assertCustomSlug(data.slug);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workspaceMemberType.update({ where: { id: memberTypeId }, data });
      await this.audit.record({
        action: 'workspace.member_type.update',
        actorType: 'user',
        actorUserId,
        resourceType: 'workspace_member_type',
        resourceId: memberTypeId,
        result: 'success',
        workspaceId,
        metadata: data,
      }, tx);
      return updated;
    });
  }

  public async deleteMemberType(
    workspaceId: number,
    memberTypeId: string,
    actorUserId: string,
  ): Promise<void> {
    this.assertDefault(workspaceId);
    const memberType = await this.findMemberType(workspaceId, memberTypeId);
    if (memberType.isSystem) throw new ConflictException('System member types cannot be deleted');
    const assignedCount = await this.prisma.workspaceMember.count({ where: { memberTypeId } });
    if (assignedCount > 0) throw new ConflictException('Assigned member type cannot be deleted');
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMemberType.delete({ where: { id: memberTypeId } });
      await this.audit.record({
        action: 'workspace.member_type.delete',
        actorType: 'user',
        actorUserId,
        resourceType: 'workspace_member_type',
        resourceId: memberTypeId,
        result: 'success',
        workspaceId,
      }, tx);
    });
  }

  private assertCustomSlug(slug: string): void {
    if (WorkspacesService.systemMemberTypeSlugs.includes(slug)) {
      throw new ConflictException('Member type slug is reserved');
    }
  }

  private async findMemberType(workspaceId: number, memberTypeId: string) {
    const memberType = await this.prisma.workspaceMemberType.findUnique({
      where: { id: memberTypeId },
    });
    if (!memberType || memberType.workspaceId !== workspaceId) {
      throw new NotFoundException('Member type not found');
    }
    return memberType;
  }
}
