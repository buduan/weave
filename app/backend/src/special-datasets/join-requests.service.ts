import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DatasetRowVersionOperation,
  DatasetStatus,
  DatasetType,
  JoinRequestStatus,
  Prisma,
} from '@prisma/client';

import type { AuthenticatedActor } from '@weave/types';

import { AuditService } from '../audit/audit.service';
import { lockDatasetParent } from '../common/aggregate-locks';
import { RelationValidationService } from '../common/relation-validation.service';
import { createRowVersion } from '../common/row-version.factory';
import { DatasetSchemaService } from '../datasets/dataset-schema.service';
import { MembersSyncService } from '../datasets/members-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DecideJoinRequestInput,
  SubmitJoinRequestInput,
} from './special-dataset-input';

/**
 * Join Request 管理服务。
 *
 * 核心规则：
 * - 仅已登录且当前成员类型为 guest 的用户可提交加入申请
 * - 每个 Join Requests Dataset 中每人最多一行（通过 DatasetRowSubject 唯一约束保证）
 * - 拒绝或撤回后可重新提交，复用已有行并创建新的 RowVersion
 * - 批准时在同一事务中：更新 WorkspaceMember 类型 + 同步 Members Dataset 行
 */
@Injectable()
export class JoinRequestsService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly schemas: DatasetSchemaService,
    private readonly membersSync: MembersSyncService,
    private readonly audit: AuditService,
    private readonly relationValidation: RelationValidationService,
  ) {}

  /**
   * 提交加入申请。
   * 自动将申请人的姓名和邮箱从 User 记录写入系统字段（忽略客户端值）。
   * 若该用户已有 rejected/withdrawn 的申请则重提；否则创建新行。
   */
  public async submit(
    workspaceId: number,
    datasetId: string,
    dto: SubmitJoinRequestInput,
    actor: AuthenticatedActor,
  ) {
    this.assertWorkspace(workspaceId, actor);
    try {
      // Serializable 隔离级别防止并发创建重复申请行。
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        await lockDatasetParent(tx, datasetId, 'share');
        const [dataset, member, fields] = await Promise.all([
          tx.dataset.findUnique({ where: { workspaceId_id: { workspaceId, id: datasetId } } }),
          tx.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
            include: { memberType: true, user: true },
          }),
          tx.datasetField.findMany({ where: { datasetId } }),
        ]);
        if (!dataset || dataset.type !== DatasetType.join_requests) {
          throw new NotFoundException('Join Requests Dataset not found');
        }
        if (dataset.status !== DatasetStatus.active) {
          throw new ConflictException('Dataset is archived');
        }
        if (!member || member.memberType.slug !== 'guest') {
          throw new ForbiddenException('Only authenticated guest members may apply');
        }
        const validated = this.schemas.validateRow(fields, dto);
        const initialSubject = await tx.datasetRowSubject.findUnique({
          where: { datasetId_userId: { datasetId, userId: actor.userId } },
          select: { rowId: true },
        });
        await this.relationValidation.validate(
          tx,
          workspaceId,
          fields,
          validated.relations,
          { updateRowIds: initialSubject ? [initialSubject.rowId] : [] },
        );
        const systemFields = new Map(fields.map((field) => [field.systemKey, field.id]));
        const nameFieldId = systemFields.get('applicant_name');
        const emailFieldId = systemFields.get('applicant_email');
        if (!nameFieldId || !emailFieldId) {
          throw new ConflictException('Join Request identity fields are not initialized');
        }
        const values: Prisma.InputJsonObject = {
          ...validated.values,
          [nameFieldId]: member.user.name,
          [emailFieldId]: member.user.email,
        };
        const subject = await tx.datasetRowSubject.findUnique({
          where: { datasetId_userId: { datasetId, userId: actor.userId } },
          include: { row: { include: { joinRequest: true } } },
        });
        if (subject) {
          const request = subject.row.joinRequest;
          if (!request) throw new ConflictException('Join Request binding is missing');
          // 仅 rejected 或 withdrawn 可重提。
          if (request.status !== JoinRequestStatus.rejected
            && request.status !== JoinRequestStatus.withdrawn) {
            throw new ConflictException('A current Join Request already exists');
          }
          return this.resubmit(
            tx,
            workspaceId,
            datasetId,
            subject.row,
            request,
            values,
            validated.relations,
            actor,
          );
        }
        return this.createRequest(tx, workspaceId, datasetId, values, validated.relations, actor);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return transactionResult;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('Join Request changed concurrently');
      }
      throw error;
    }
  }

  /** 批准加入申请。必须提供目标成员类型 ID（非 guest）。 */
  public async approve(
    workspaceId: number,
    rowId: string,
    dto: DecideJoinRequestInput,
    actor: AuthenticatedActor,
  ) {
    this.assertWorkspace(workspaceId, actor);
    if (!dto.memberTypeId) throw new BadRequestException('Approval requires memberTypeId');
    return this.decide(workspaceId, rowId, dto, actor, JoinRequestStatus.approved);
  }

  /** 拒绝加入申请。 */
  public async reject(
    workspaceId: number,
    rowId: string,
    dto: DecideJoinRequestInput,
    actor: AuthenticatedActor,
  ) {
    this.assertWorkspace(workspaceId, actor);
    return this.decide(workspaceId, rowId, dto, actor, JoinRequestStatus.rejected);
  }

  /**
   * 统一的审核决策入口。
   *
   * 批准时在同一事务内：
   * 1. 更新 JoinRequest 状态
   * 2. 更新 WorkspaceMember 的 memberTypeId
   * 3. 调用 MembersSyncService 同步 Members Dataset 扩展行
   *
   * 任何一步失败则整个事务回滚，不会出现"已批准但没有成员行"的中间状态。
   */
  private async decide(
    workspaceId: number,
    rowId: string,
    dto: DecideJoinRequestInput,
    actor: AuthenticatedActor,
    status: 'approved' | 'rejected',
  ) {
    this.assertCanReview(actor);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.joinRequest.findUnique({
        where: { rowId },
        include: { row: { include: { subject: true, sourceRelations: true } } },
      });
      if (!request || request.workspaceId !== workspaceId || !request.row.subject) {
        throw new NotFoundException('Join Request not found');
      }

      // 批准时验证目标成员类型：必须属于本 Workspace 且非 guest 系统类型。
      let memberTypeId: string | null = null;
      if (status === JoinRequestStatus.approved) {
        const memberType = await tx.workspaceMemberType.findUnique({
          where: { id: dto.memberTypeId! },
        });
        if (!memberType || memberType.workspaceId !== workspaceId
          || (memberType.isSystem && memberType.slug === 'guest')) {
          throw new BadRequestException('Approval member type must be non-guest and in this Workspace');
        }
        memberTypeId = memberType.id;
      }

      // CAS 更新 JoinRequest 状态。
      const result = await tx.joinRequest.updateMany({
        where: { rowId, revision: dto.expectedRevision, status: JoinRequestStatus.submitted },
        data: {
          status,
          revision: { increment: 1 },
          decidedAt: new Date(),
          decidedByUserId: actor.userId,
          approvedMemberTypeId: memberTypeId,
          decisionNote: dto.note,
        },
      });
      if (result.count !== 1) throw new ConflictException('Join Request revision is stale');

      // 递增行 revision 并创建版本快照。
      const row = await tx.datasetRow.update({
        where: { id: rowId },
        data: { revision: { increment: 1 }, updatedByUserId: actor.userId },
      });
      const relations = this.snapshotExistingRelations(request.row.sourceRelations);
      await tx.datasetRowVersion.create({
        data: {
          rowId,
          version: row.revision,
          operation: DatasetRowVersionOperation.update,
          valuesSnapshot: row.values as Prisma.InputJsonObject,
          relationsSnapshot: relations,
          changedFieldIds: [],
          actorUserId: actor.userId,
        },
      });

      // 批准 → 升级成员类型并同步 Members Dataset。
      if (status === JoinRequestStatus.approved) {
        const member = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId,
              userId: request.row.subject.userId,
            },
          },
          include: { memberType: true },
        });
        if (!member || member.memberType.slug !== 'guest') {
          throw new ConflictException('Applicant is no longer a guest member');
        }
        await tx.workspaceMember.update({
          where: { id: member.id },
          data: { memberTypeId: memberTypeId!, joinedAt: member.joinedAt ?? new Date() },
        });
        // 同步 Members Dataset：创建或恢复该成员的扩展行。
        await this.membersSync.synchronize(tx, workspaceId, member.id, actor.userId);
      }

      await this.audit.record({
        action: `join_request.${status}`,
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'join_request',
        resourceId: rowId,
        result: 'success',
        workspaceId,
        metadata: { approvedMemberTypeId: memberTypeId },
      }, tx);
      return tx.joinRequest.findUniqueOrThrow({ where: { rowId } });
    });
  }

  /** 创建新的加入申请（行 + DatasetRowSubject + JoinRequest）。 */
  private async createRequest(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    datasetId: string,
    values: Prisma.InputJsonObject,
    relations: Map<string, string[]>,
    actor: AuthenticatedActor,
  ) {
    const row = await tx.datasetRow.create({
      data: {
        workspaceId,
        datasetId,
        values,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
    await this.writeRelations(tx, workspaceId, datasetId, row.id, relations);
    // 同时创建用户-行绑定和 JoinRequest 记录。
    await Promise.all([
      tx.datasetRowSubject.create({
        data: {
          workspaceId, datasetId, rowId: row.id, userId: actor.userId,
        },
      }),
      tx.joinRequest.create({
        data: {
          workspaceId,
          datasetId,
          rowId: row.id,
          status: JoinRequestStatus.submitted,
          submittedAt: new Date(),
        },
      }),
    ]);
    await createRowVersion({
      tx,
      rowId: row.id,
      version: row.revision,
      operation: DatasetRowVersionOperation.create,
      values,
      relations,
      actorUserId: actor.userId,
    });
    await this.recordSubmissionAudit(tx, workspaceId, datasetId, row.id, actor.userId, 'create');
    return tx.joinRequest.findUniqueOrThrow({ where: { rowId: row.id } });
  }

  /** 重新提交已拒绝或已撤回的申请。复用已有行，重置 JoinRequest 状态。 */
  private async resubmit(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    datasetId: string,
    row: { id: string; revision: number },
    request: { revision: number },
    values: Prisma.InputJsonObject,
    relations: Map<string, string[]>,
    actor: AuthenticatedActor,
  ) {
    const updated = await tx.datasetRow.update({
      where: { id: row.id },
      data: {
        values,
        deletedAt: null,
        revision: { increment: 1 },
        updatedByUserId: actor.userId,
      },
    });
    // 清除旧关联并写入新关联。
    await tx.datasetRelation.deleteMany({ where: { sourceRowId: row.id } });
    await this.writeRelations(tx, workspaceId, datasetId, row.id, relations);
    // 重置 JoinRequest 为 submitted。
    await tx.joinRequest.update({
      where: { rowId: row.id },
      data: {
        status: JoinRequestStatus.submitted,
        submittedAt: new Date(),
        decidedAt: null,
        decidedByUserId: null,
        approvedMemberTypeId: null,
        decisionNote: null,
        revision: request.revision + 1,
      },
    });
    await createRowVersion({
      tx,
      rowId: row.id,
      version: updated.revision,
      operation: DatasetRowVersionOperation.update,
      values,
      relations,
      actorUserId: actor.userId,
    });
    await this.recordSubmissionAudit(tx, workspaceId, datasetId, row.id, actor.userId, 'resubmit');
    return tx.joinRequest.findUniqueOrThrow({ where: { rowId: row.id } });
  }

  /** 将关联关系写入 DatasetRelation。 */
  private async writeRelations(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    datasetId: string,
    rowId: string,
    relations: Map<string, string[]>,
  ): Promise<void> {
    const fields = await tx.datasetField.findMany({
      where: { id: { in: [...relations.keys()] } },
      select: { id: true, relationTargetDatasetId: true },
    });
    const targets = new Map(fields.map((field) => [field.id, field.relationTargetDatasetId]));
    const data = [...relations.entries()].flatMap(([fieldId, rowIds]) => rowIds.map(
      (targetRowId, position) => ({
        workspaceId,
        sourceDatasetId: datasetId,
        sourceRowId: rowId,
        fieldId,
        targetDatasetId: targets.get(fieldId)!,
        targetRowId,
        position,
      }),
    ));
    if (data.length > 0) await tx.datasetRelation.createMany({ data });
  }

  /** 将已有关联数组转换为 { fieldId → targetRowId[] } 快照格式。 */
  private snapshotExistingRelations(
    relations: Array<{ fieldId: string; position: number; targetRowId: string }>,
  ): Prisma.InputJsonObject {
    const result: Record<string, string[]> = {};
    relations.sort((left, right) => left.position - right.position).forEach((relation) => {
      result[relation.fieldId] = [...(result[relation.fieldId] ?? []), relation.targetRowId];
    });
    return result;
  }

  /** 记录 Join Request 提交/重提的审计日志。 */
  private async recordSubmissionAudit(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    datasetId: string,
    rowId: string,
    actorUserId: string,
    operation: string,
  ): Promise<void> {
    await this.audit.record({
      action: 'join_request.submit',
      actorType: 'user',
      actorUserId,
      resourceType: 'join_request',
      resourceId: rowId,
      result: 'success',
      workspaceId,
      metadata: { datasetId, operation },
    }, tx);
  }

  /** 守卫操作者属于请求的 Workspace（当前仅支持 workspace 1）。 */
  private assertWorkspace(workspaceId: number, actor: AuthenticatedActor): void {
    if (workspaceId !== 1 || actor.workspaceId !== workspaceId) {
      throw new ForbiddenException('Workspace access denied');
    }
  }

  /** Join Request 审核需要显式审核权限；提交权限不等同于审核权限。 */
  private assertCanReview(actor: AuthenticatedActor): void {
    if (!actor.isSystemAdmin && !actor.isWorkspaceAdmin
      && !actor.permissions.includes('join_request.review')) {
      throw new ForbiddenException('Join Request review permission is required');
    }
  }
}
