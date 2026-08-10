import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DatasetCollaboratorRole,
  DatasetFieldKind,
  DatasetStatus,
  DatasetType,
  MemberStatus,
  Prisma,
} from '@prisma/client';

import type {
  AuthenticatedActor,
  DatasetCapabilities,
  DatasetCreatorSummary,
  DatasetDetailResponse,
  DatasetFieldDefinition,
  DatasetListResponse,
  DatasetSummary,
  JsonSchema,
} from '@weave/types';
import {
  hasChoiceMembershipSchema,
  normalizeDatasetChoiceConfig,
} from '@weave/utils';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { createDatasetDefinitionVersion } from './dataset-definition-version';
import { DatasetSchemaService } from './dataset-schema.service';
import type {
  AddDatasetCollaboratorInput,
  ArchiveDatasetFieldInput,
  CreateDatasetFieldInput,
  CreateDatasetInput,
  UpdateDatasetFieldInput,
  UpdateDatasetInput,
} from './dataset-input';

/** 同时接受交互式事务 client 和单例 PrismaService 的数据库客户端类型。 */
type DbClient = Prisma.TransactionClient | PrismaService;

const datasetSummarySelect = {
  id: true,
  workspaceId: true,
  name: true,
  slug: true,
  description: true,
  type: true,
  status: true,
  subjectMode: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  createdBy: {
    select: {
      id: true, name: true, nickname: true, username: true, avatarUrl: true,
    },
  },
  collaborators: { select: { workspaceMemberId: true, role: true } },
} satisfies Prisma.DatasetSelect;

/**
 * 管理 Dataset 的元数据、字段、协作者及定义版本历史。
 * 所有变更 Dataset 定义的写操作均在同一事务中创建不可变 DatasetVersion 快照并写入 AuditLog。
 */
@Injectable()
export class DatasetsService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly schemas: DatasetSchemaService,
  ) {}

  /**
   * 列出当前操作者可见的 Dataset。
   * 系统/Workspace 管理员及持有全局读取权限的用户可以看到全部；
   * 其他用户只能看到自己作为协作者的 Dataset。
   */
  public async list(workspaceId: number, actor: AuthenticatedActor) {
    this.assertWorkspace(workspaceId, actor);
    const elevated = this.hasGlobalRead(actor);
    const member = elevated ? null : await this.findActorMember(workspaceId, actor.userId);
    const datasets = await this.prisma.dataset.findMany({
      where: {
        workspaceId,
        // 非特权用户仅列出自己为协作者的 Dataset。
        ...(!elevated && {
          collaborators: { some: { workspaceMemberId: member?.id ?? '__missing__' } },
        }),
      },
      select: datasetSummarySelect,
      orderBy: { createdAt: 'desc' },
    });
    const actorMember = member ?? await this.findActorMember(workspaceId, actor.userId);
    return {
      items: datasets.map((dataset) => ({
        ...this.toSummary(dataset),
        creator: this.toCreator(dataset.createdBy),
        capabilities: this.capabilitiesFor(
          dataset,
          actor,
          dataset.collaborators.find((item) => item.workspaceMemberId === actorMember?.id)?.role,
        ),
      })),
      canCreate: this.canCreate(actor),
    } satisfies DatasetListResponse;
  }

  /** 获取单个 Dataset 的安全详情、活跃字段和服务端能力。 */
  public async get(workspaceId: number, datasetId: string, actor: AuthenticatedActor) {
    this.assertWorkspace(workspaceId, actor);
    await this.assertCanRead(workspaceId, datasetId, actor);
    const dataset = await this.prisma.dataset.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: datasetId } },
      select: {
        ...datasetSummarySelect,
        fields: {
          where: { archivedAt: null },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            datasetId: true,
            key: true,
            name: true,
            description: true,
            kind: true,
            valueSchema: true,
            config: true,
            required: true,
            isSystemManaged: true,
            systemKey: true,
            relationTargetDatasetId: true,
            relationCardinality: true,
            position: true,
            revision: true,
            archivedAt: true,
          },
        },
      },
    });
    const actorMember = await this.findActorMember(workspaceId, actor.userId);
    return {
      dataset: this.toSummary(dataset),
      fields: dataset.fields.map((field) => this.toField(field)),
      creator: this.toCreator(dataset.createdBy),
      capabilities: this.capabilitiesFor(
        dataset,
        actor,
        dataset.collaborators.find((item) => item.workspaceMemberId === actorMember?.id)?.role,
      ),
    } satisfies DatasetDetailResponse;
  }

  /**
   * 创建 Dataset 及其首个 owner 协作者。
   * members 和 activity_registrations 类型会被拒绝 —— 它们必须由各自的
   * 所属模块（MembersSyncService / ActivitiesService）创建。
   * join_requests 类型的 Dataset 会自动创建 applicant_name、applicant_email
   * 两个系统字段，并强制 subjectMode 为 single_per_user。
   */
  public async create(
    workspaceId: number,
    dto: CreateDatasetInput,
    actor: AuthenticatedActor,
  ) {
    this.assertWorkspace(workspaceId, actor);
    if (!this.canCreate(actor)) throw new ForbiddenException('Dataset creation is not granted');
    if (dto.type === DatasetType.members || dto.type === DatasetType.activity_registrations) {
      throw new BadRequestException('This Dataset type is created only by its owning module');
    }
    const member = await this.findActorMember(workspaceId, actor.userId);
    if (!member && !actor.isSystemAdmin) {
      throw new ForbiddenException('A Workspace member is required to own a Dataset');
    }
    // 系统管理员可能不是 Workspace 成员，此时回退到 Workspace 的 owner。
    const owner = member ?? await this.findWorkspaceOwnerMember(workspaceId);

    try {
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        const dataset = await tx.dataset.create({
          data: {
            workspaceId,
            name: dto.name,
            slug: dto.slug,
            description: dto.description,
            type: dto.type,
            // Join Requests Dataset 强制使用每用户一行的语义。
            subjectMode: dto.type === DatasetType.join_requests
              ? 'single_per_user'
              : dto.subjectMode,
            createdByUserId: actor.userId,
            collaborators: {
              create: {
                workspaceMemberId: owner.id,
                role: DatasetCollaboratorRole.owner,
                assignedByUserId: actor.userId,
              },
            },
            // Join Requests Dataset 创建时附带两个系统管理的身份字段。
            ...(dto.type === DatasetType.join_requests && {
              fields: {
                create: [
                  {
                    key: 'applicant_name',
                    name: 'Applicant name',
                    kind: DatasetFieldKind.text,
                    valueSchema: { type: 'string', minLength: 1, maxLength: 128 },
                    required: true,
                    isSystemManaged: true,
                    systemKey: 'applicant_name',
                    position: 0,
                  },
                  {
                    key: 'applicant_email',
                    name: 'Applicant email',
                    kind: DatasetFieldKind.email,
                    valueSchema: { type: 'string', format: 'email', maxLength: 320 },
                    required: true,
                    isSystemManaged: true,
                    systemKey: 'applicant_email',
                    position: 1,
                  },
                ],
              },
            }),
          },
        });
        // 保存初始定义的不可变快照。
        await this.createDefinitionVersion(tx, dataset.id, actor.userId, 'dataset.create');
        await this.audit.record({
          action: 'dataset.create',
          actorType: 'user',
          actorUserId: actor.userId,
          resourceType: 'dataset',
          resourceId: dataset.id,
          result: 'success',
          workspaceId,
          metadata: { type: dataset.type, slug: dataset.slug },
        }, tx);
        return dataset;
      });
      return transactionResult;
    } catch (error) {
      // P2002 = 唯一约束冲突 → slug 重复。
      return this.rethrowUniqueConflict(error, 'Dataset slug is already in use');
    }
  }

  /**
   * 通过乐观锁更新 Dataset 元数据。
   * 仅 owner、maintainer 和管理员可操作。
   */
  public async update(
    workspaceId: number,
    datasetId: string,
    dto: UpdateDatasetInput,
    actor: AuthenticatedActor,
  ) {
    const dataset = await this.assertCanManage(workspaceId, datasetId, actor);
    this.assertTypeCapability(dataset.type, 'metadata');
    this.assertActive(dataset.status);
    try {
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        // updateMany + count 校验实现 CAS（compare-and-swap）乐观锁。
        const result = await tx.dataset.updateMany({
          where: { id: datasetId, workspaceId, revision: dto.expectedRevision },
          data: {
            name: dto.name,
            slug: dto.slug,
            description: dto.description,
            revision: { increment: 1 },
          },
        });
        if (result.count !== 1) throw new ConflictException('Dataset revision is stale');
        const updatedDataset = await tx.dataset.findUniqueOrThrow({ where: { id: datasetId } });
        await this.createDefinitionVersion(tx, datasetId, actor.userId, 'dataset.update');
        await this.audit.record({
          action: 'dataset.update',
          actorType: 'user',
          actorUserId: actor.userId,
          resourceType: 'dataset',
          resourceId: datasetId,
          result: 'success',
          workspaceId,
          metadata: { revision: updatedDataset.revision },
        }, tx);
        return updatedDataset;
      });
      return transactionResult;
    } catch (error) {
      return this.rethrowUniqueConflict(error, 'Dataset slug is already in use');
    }
  }

  /**
   * 归档 Dataset。归档后不可新增行、字段或 Form 提交。
   * Dataset 永不物理删除 —— 其行、版本和历史记录均保留以供审计。
   */
  public async archive(
    workspaceId: number,
    datasetId: string,
    expectedRevision: number,
    actor: AuthenticatedActor,
  ) {
    const managedDataset = await this.assertCanManage(workspaceId, datasetId, actor);
    this.assertTypeCapability(managedDataset.type, 'archive');
    this.assertActive(managedDataset.status);
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.dataset.updateMany({
        where: {
          id: datasetId,
          workspaceId,
          revision: expectedRevision,
          status: DatasetStatus.active,
        },
        data: {
          status: DatasetStatus.archived,
          archivedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new ConflictException('Dataset revision is stale or archived');
      const dataset = await tx.dataset.findUniqueOrThrow({ where: { id: datasetId } });
      await this.createDefinitionVersion(tx, datasetId, actor.userId, 'dataset.archive');
      await this.audit.record({
        action: 'dataset.archive',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'dataset',
        resourceId: datasetId,
        result: 'success',
        workspaceId,
      }, tx);
      return dataset;
    });
  }

  /**
   * 添加或更新 Dataset 协作者。
   * 仅 owner（或管理员）可管理协作者；将最后一名 owner 降级为 maintainer 会被阻止。
   */
  public async addCollaborator(
    workspaceId: number,
    datasetId: string,
    dto: AddDatasetCollaboratorInput,
    actor: AuthenticatedActor,
  ) {
    await this.assertCanManage(workspaceId, datasetId, actor, true);
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: dto.workspaceMemberId },
    });
    if (!member || member.workspaceId !== workspaceId || member.status === MemberStatus.removed) {
      throw new BadRequestException('Collaborator must be a current member of this Workspace');
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.datasetCollaborator.findUnique({
        where: {
          datasetId_workspaceMemberId: {
            datasetId,
            workspaceMemberId: dto.workspaceMemberId,
          },
        },
      });
      // 守卫：活跃 Dataset 必须始终至少保留一名 owner。
      if (existing?.role === DatasetCollaboratorRole.owner
        && dto.role !== DatasetCollaboratorRole.owner) {
        await this.assertNotFinalOwner(tx, datasetId, dto.workspaceMemberId);
      }
      const collaborator = await tx.datasetCollaborator.upsert({
        where: {
          datasetId_workspaceMemberId: {
            datasetId,
            workspaceMemberId: dto.workspaceMemberId,
          },
        },
        create: {
          workspaceId,
          datasetId,
          workspaceMemberId: dto.workspaceMemberId,
          role: dto.role,
          assignedByUserId: actor.userId,
        },
        update: { role: dto.role, assignedByUserId: actor.userId },
      });
      await this.audit.record({
        action: 'dataset.collaborator.assign',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'dataset',
        resourceId: datasetId,
        result: 'success',
        workspaceId,
        metadata: { role: dto.role, workspaceMemberId: dto.workspaceMemberId },
      }, tx);
      return collaborator;
    });
  }

  /**
   * 移除协作者。移除活跃 Dataset 的最后一名 owner 会被拒绝。
   */
  public async removeCollaborator(
    workspaceId: number,
    datasetId: string,
    workspaceMemberId: string,
    actor: AuthenticatedActor,
  ): Promise<void> {
    await this.assertCanManage(workspaceId, datasetId, actor, true);
    await this.prisma.$transaction(async (tx) => {
      const collaborator = await tx.datasetCollaborator.findUnique({
        where: { datasetId_workspaceMemberId: { datasetId, workspaceMemberId } },
      });
      if (!collaborator) throw new NotFoundException('Dataset collaborator not found');
      if (collaborator.role === DatasetCollaboratorRole.owner) {
        await this.assertNotFinalOwner(tx, datasetId, workspaceMemberId);
      }
      await tx.datasetCollaborator.delete({
        where: { datasetId_workspaceMemberId: { datasetId, workspaceMemberId } },
      });
      await this.audit.record({
        action: 'dataset.collaborator.remove',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'dataset',
        resourceId: datasetId,
        result: 'success',
        workspaceId,
        metadata: { workspaceMemberId },
      }, tx);
    });
  }

  /**
   * 创建 Dataset 字段。字段的 valueSchema 会先通过 AJV Draft 2020-12 编译校验；
   * 关联字段还会校验目标 Dataset 和基数。position 不传时追加到现有活跃字段末尾。
   */
  public async createField(
    workspaceId: number,
    datasetId: string,
    dto: CreateDatasetFieldInput,
    actor: AuthenticatedActor,
  ) {
    const dataset = await this.assertCanManage(workspaceId, datasetId, actor);
    this.assertActive(dataset.status);
    this.assertTypeCapability(dataset.type, 'fields');
    // 提前编译 value schema，失败时不碰数据库。
    const valueSchema = this.schemas.assertFieldSchema(dto.valueSchema);
    const config = this.normalizeChoiceConfigForWrite(
      dto.kind,
      dto.config,
      dto.valueSchema as JsonSchema,
      true,
    );
    await this.assertRelationConfiguration(workspaceId, dto);
    try {
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        await this.incrementDatasetRevision(
          tx,
          workspaceId,
          datasetId,
          dto.expectedDatasetRevision,
          'Dataset revision is stale',
          DatasetStatus.active,
        );
        const activeFieldIds = await this.findActiveFieldIds(tx, datasetId);
        const position = Math.min(dto.position ?? activeFieldIds.length, activeFieldIds.length);
        const field = await tx.datasetField.create({
          data: {
            workspaceId,
            datasetId,
            key: dto.key,
            name: dto.name,
            description: dto.description,
            kind: dto.kind,
            valueSchema,
            config,
            required: dto.required,
            relationTargetDatasetId: dto.relationTargetDatasetId,
            relationCardinality: dto.relationCardinality,
            position,
          },
        });
        const orderedIds = [...activeFieldIds];
        orderedIds.splice(position, 0, field.id);
        await this.normalizeFieldPositions(tx, orderedIds);
        await this.createDefinitionVersion(tx, datasetId, actor.userId, 'dataset.field.create');
        await this.audit.record({
          action: 'dataset.field.create',
          actorType: 'user',
          actorUserId: actor.userId,
          resourceType: 'dataset_field',
          resourceId: field.id,
          result: 'success',
          workspaceId,
          metadata: { datasetId, kind: field.kind },
        }, tx);
        return {
          field: this.toField({ ...field, position }),
          datasetRevision: dto.expectedDatasetRevision + 1,
        };
      });
      return transactionResult;
    } catch (error) {
      // P2002 = 唯一约束冲突 → key 重复。
      return this.rethrowUniqueConflict(error, 'Dataset field key is already in use');
    }
  }

  /**
   * 通过乐观锁更新 Dataset 字段。
   * 系统管理字段（isSystemManaged=true）拒绝修改 key、valueSchema、config、required。
   */
  public async updateField(
    workspaceId: number,
    datasetId: string,
    fieldId: string,
    dto: UpdateDatasetFieldInput,
    actor: AuthenticatedActor,
  ) {
    const dataset = await this.assertCanManage(workspaceId, datasetId, actor);
    this.assertActive(dataset.status);
    this.assertTypeCapability(dataset.type, 'fields');
    const field = await this.findField(workspaceId, datasetId, fieldId);
    // 系统字段（如 applicant_name、applicant_email）不可修改定义。
    if (field.isSystemManaged && (
      dto.valueSchema !== undefined
      || dto.config !== undefined
      || dto.required !== undefined
    )) {
      throw new ConflictException('Protected system field definition cannot be changed');
    }
    const valueSchema = dto.valueSchema === undefined
      ? undefined
      : this.schemas.assertFieldSchema(dto.valueSchema);
    const config = dto.config === undefined
      ? undefined
      : this.normalizeChoiceConfigForWrite(
        field.kind,
        dto.config,
        (dto.valueSchema ?? field.valueSchema) as JsonSchema,
        dto.valueSchema !== undefined,
      );
    try {
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        await this.incrementDatasetRevision(
          tx,
          workspaceId,
          datasetId,
          dto.expectedDatasetRevision,
          'Dataset revision is stale',
          DatasetStatus.active,
        );
        const result = await tx.datasetField.updateMany({
          where: {
            id: fieldId, workspaceId, datasetId, revision: dto.expectedFieldRevision,
          },
          data: {
            name: dto.name,
            description: dto.description,
            valueSchema,
            config,
            required: dto.required,
            revision: { increment: 1 },
          },
        });
        if (result.count !== 1) throw new ConflictException('Dataset field revision is stale');
        const activeFieldIds = await this.findActiveFieldIds(tx, datasetId, fieldId);
        const orderedIds = [...activeFieldIds];
        const position = Math.min(dto.position ?? field.position, orderedIds.length);
        orderedIds.splice(position, 0, fieldId);
        await this.normalizeFieldPositions(tx, orderedIds);
        const updated = await tx.datasetField.findUniqueOrThrow({ where: { id: fieldId } });
        await this.createDefinitionVersion(tx, datasetId, actor.userId, 'dataset.field.update');
        await this.audit.record({
          action: 'dataset.field.update',
          actorType: 'user',
          actorUserId: actor.userId,
          resourceType: 'dataset_field',
          resourceId: fieldId,
          result: 'success',
          workspaceId,
          metadata: { datasetId, revision: updated.revision },
        }, tx);
        return {
          field: this.toField(updated),
          datasetRevision: dto.expectedDatasetRevision + 1,
        };
      });
      return transactionResult;
    } catch (error) {
      return this.rethrowUniqueConflict(error, 'Dataset field key is already in use');
    }
  }

  /**
   * 归档 Dataset 字段。系统管理字段不可归档。
   * 归档后新行不可写入该字段，但已有数据和历史版本保留。
   */
  public async archiveField(
    workspaceId: number,
    datasetId: string,
    fieldId: string,
    dto: ArchiveDatasetFieldInput,
    actor: AuthenticatedActor,
  ) {
    const dataset = await this.assertCanManage(workspaceId, datasetId, actor);
    this.assertActive(dataset.status);
    this.assertTypeCapability(dataset.type, 'fields');
    const field = await this.findField(workspaceId, datasetId, fieldId);
    if (field.isSystemManaged) throw new ConflictException('Protected system fields cannot be archived');
    return this.prisma.$transaction(async (tx) => {
      await this.incrementDatasetRevision(
        tx,
        workspaceId,
        datasetId,
        dto.expectedDatasetRevision,
        'Dataset revision is stale',
        DatasetStatus.active,
      );
      const result = await tx.datasetField.updateMany({
        where: {
          id: fieldId,
          datasetId,
          workspaceId,
          revision: dto.expectedFieldRevision,
          archivedAt: null,
        },
        data: { archivedAt: new Date(), revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new ConflictException('Dataset field revision is stale or archived');
      const updated = await tx.datasetField.findUniqueOrThrow({ where: { id: fieldId } });
      const activeFieldIds = await this.findActiveFieldIds(tx, datasetId);
      await this.normalizeFieldPositions(tx, activeFieldIds);
      await this.createDefinitionVersion(tx, datasetId, actor.userId, 'dataset.field.archive');
      await this.audit.record({
        action: 'dataset.field.archive',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'dataset_field',
        resourceId: fieldId,
        result: 'success',
        workspaceId,
        metadata: { datasetId },
      }, tx);
      return {
        field: this.toField(updated),
        datasetRevision: dto.expectedDatasetRevision + 1,
      };
    });
  }

  /**
   * 断言操作者有读取该 Dataset 的权限。
   * 管理员和持有全局权限的用户直接通过；其余必须为协作者。
   * 接受可选的事务 client，便于在事务内部复用。
   */
  public async assertCanRead(
    workspaceId: number,
    datasetId: string,
    actor: AuthenticatedActor,
    client: DbClient = this.prisma,
  ) {
    const dataset = await this.findDatasetOrThrow(workspaceId, datasetId, actor, client);
    if (this.hasGlobalRead(actor)) return dataset;
    const member = await this.findActorMember(workspaceId, actor.userId, client);
    const collaborator = member && await client.datasetCollaborator.findUnique({
      where: { datasetId_workspaceMemberId: { datasetId, workspaceMemberId: member.id } },
    });
    if (!collaborator) throw new ForbiddenException('Dataset access is not granted');
    return dataset;
  }

  /**
   * 断言操作者有管理该 Dataset 的权限（创建/更新字段等）。
   * ownerOnly=true 时仅 owner 可通过，maintainer 被拒绝。
   */
  public async assertCanManage(
    workspaceId: number,
    datasetId: string,
    actor: AuthenticatedActor,
    ownerOnly = false,
    client: DbClient = this.prisma,
  ) {
    const dataset = await this.findDatasetOrThrow(workspaceId, datasetId, actor, client);
    // 系统/Workspace 管理员及持有 dataset.manage_all 权限的用户绕过协作者校验。
    if (actor.isSystemAdmin || actor.isWorkspaceAdmin || actor.permissions.includes('dataset.manage_all')) {
      return dataset;
    }
    const member = await this.findActorMember(workspaceId, actor.userId, client);
    const collaborator = member && await client.datasetCollaborator.findUnique({
      where: { datasetId_workspaceMemberId: { datasetId, workspaceMemberId: member.id } },
    });
    if (!collaborator || (ownerOnly && collaborator.role !== DatasetCollaboratorRole.owner)) {
      throw new ForbiddenException('Dataset management access is not granted');
    }
    return dataset;
  }

  /** 断言普通 HTTP 行创建符合 Dataset 类型策略。 */
  public async assertCanCreateRows(
    workspaceId: number,
    datasetId: string,
    actor: AuthenticatedActor,
  ) {
    const dataset = await this.assertCanManage(workspaceId, datasetId, actor);
    this.assertActive(dataset.status);
    this.assertTypeCapability(dataset.type, 'row_create');
    return dataset;
  }

  /** 断言普通 HTTP 行更新符合 Dataset 类型策略。 */
  public async assertCanUpdateRows(
    workspaceId: number,
    datasetId: string,
    actor: AuthenticatedActor,
  ) {
    const dataset = await this.assertCanManage(workspaceId, datasetId, actor);
    this.assertActive(dataset.status);
    this.assertTypeCapability(dataset.type, 'row_update');
    return dataset;
  }

  /** 断言普通 HTTP 行删除符合 Dataset 类型策略。 */
  public async assertCanDeleteRows(
    workspaceId: number,
    datasetId: string,
    actor: AuthenticatedActor,
  ) {
    const dataset = await this.assertCanManage(workspaceId, datasetId, actor);
    this.assertActive(dataset.status);
    this.assertTypeCapability(dataset.type, 'row_delete');
    return dataset;
  }

  /**
   * 创建不可变 DatasetVersion 快照，保存当前元数据及所有字段定义（含已归档字段）。
   * 版本号与 Dataset.revision 一致。必须在已有事务内调用。
   */
  public async createDefinitionVersion(
    tx: Prisma.TransactionClient,
    datasetId: string,
    actorUserId: string,
    reason: string,
  ): Promise<void> {
    await createDatasetDefinitionVersion(tx, datasetId, actorUserId, reason);
  }

  private canCreate(actor: AuthenticatedActor): boolean {
    return actor.isSystemAdmin
      || actor.isWorkspaceAdmin
      || actor.permissions.includes('dataset.create')
      || actor.permissions.includes('dataset.manage_all');
  }

  private capabilitiesFor(
    dataset: { status: DatasetStatus; type: DatasetType },
    actor: AuthenticatedActor,
    collaboratorRole?: DatasetCollaboratorRole,
  ): DatasetCapabilities {
    const canManage = actor.isSystemAdmin
      || actor.isWorkspaceAdmin
      || actor.permissions.includes('dataset.manage_all')
      || collaboratorRole !== undefined;
    const active = dataset.status === DatasetStatus.active;
    if (!canManage || !active || dataset.type === DatasetType.activity_registrations) {
      return this.emptyCapabilities();
    }
    if (dataset.type === DatasetType.members) {
      return {
        ...this.emptyCapabilities(),
        canManageFields: true,
        canUpdateRows: true,
      };
    }
    if (dataset.type === DatasetType.join_requests) {
      return {
        ...this.emptyCapabilities(),
        canUpdateMetadata: true,
        canArchive: true,
        canManageFields: true,
      };
    }
    return {
      canUpdateMetadata: true,
      canArchive: true,
      canManageFields: true,
      canCreateRows: true,
      canUpdateRows: true,
      canDeleteRows: true,
    };
  }

  private emptyCapabilities(): DatasetCapabilities {
    return {
      canUpdateMetadata: false,
      canArchive: false,
      canManageFields: false,
      canCreateRows: false,
      canUpdateRows: false,
      canDeleteRows: false,
    };
  }

  private assertTypeCapability(
    type: DatasetType,
    operation: 'archive' | 'fields' | 'metadata' | 'row_create' | 'row_delete' | 'row_update',
  ): void {
    const allowed = type === DatasetType.standard
      || (type === DatasetType.members && (operation === 'fields' || operation === 'row_update'))
      || (type === DatasetType.join_requests
        && (operation === 'archive' || operation === 'fields' || operation === 'metadata'));
    if (!allowed) throw new ForbiddenException(`Dataset type does not allow ${operation}`);
  }

  /** Canonicalize new choice config writes while leaving unrelated UI config untouched. */
  private normalizeChoiceConfigForWrite(
    kind: DatasetFieldKind,
    config: Record<string, unknown>,
    valueSchema: JsonSchema,
    rejectSubmittedMembership: boolean,
  ): Prisma.InputJsonObject {
    if (kind !== DatasetFieldKind.single_select && kind !== DatasetFieldKind.multi_select) {
      return config as Prisma.InputJsonObject;
    }
    const normalized = normalizeDatasetChoiceConfig(kind, config, {
      allowLegacyStrings: false,
    });
    if (!normalized.hasOptions) {
      throw new BadRequestException('New Dataset choice config must declare options');
    }
    if (rejectSubmittedMembership && hasChoiceMembershipSchema(valueSchema)) {
      throw new BadRequestException(
        'Dataset choice membership must be declared only in config.options',
      );
    }
    return {
      ...config,
      options: normalized.options as unknown as Prisma.InputJsonArray,
      ...(normalized.optionMode === 'cascader' && { optionMode: 'cascader' }),
    } as Prisma.InputJsonObject;
  }

  private toSummary(dataset: {
    createdAt: Date;
    description: string | null;
    id: string;
    name: string;
    revision: number;
    slug: string;
    status: DatasetStatus;
    subjectMode: 'none' | 'single_per_user';
    type: DatasetType;
    updatedAt: Date;
    workspaceId: number;
  }): DatasetSummary {
    return {
      id: dataset.id,
      workspaceId: dataset.workspaceId,
      name: dataset.name,
      slug: dataset.slug,
      description: dataset.description,
      type: dataset.type,
      status: dataset.status,
      subjectMode: dataset.subjectMode,
      revision: dataset.revision,
      createdAt: dataset.createdAt.toISOString(),
      updatedAt: dataset.updatedAt.toISOString(),
    };
  }

  private toCreator(user: {
    avatarUrl: string | null;
    id: string;
    name: string;
    nickname: string;
    username: string;
  }): DatasetCreatorSummary {
    return {
      id: user.id,
      displayName: user.nickname || user.name || user.username,
      avatarUrl: user.avatarUrl,
    };
  }

  private toField(field: {
    archivedAt: Date | null;
    config: Prisma.JsonValue;
    datasetId: string;
    description: string | null;
    id: string;
    isSystemManaged: boolean;
    key: string;
    kind: DatasetFieldKind;
    name: string;
    position: number;
    relationCardinality: 'many' | 'one' | null;
    relationTargetDatasetId: string | null;
    required: boolean;
    revision: number;
    systemKey: string | null;
    valueSchema: Prisma.JsonValue;
  }): DatasetFieldDefinition {
    return {
      id: field.id,
      datasetId: field.datasetId,
      key: field.key,
      name: field.name,
      description: field.description,
      kind: field.kind,
      valueSchema: field.valueSchema as DatasetFieldDefinition['valueSchema'],
      config: field.config as DatasetFieldDefinition['config'],
      required: field.required,
      isSystemManaged: field.isSystemManaged,
      systemKey: field.systemKey,
      relationTargetDatasetId: field.relationTargetDatasetId,
      relationCardinality: field.relationCardinality,
      position: field.position,
      revision: field.revision,
      archivedAt: field.archivedAt?.toISOString() ?? null,
    };
  }

  /** 守卫操作者属于请求的 Workspace（当前仅支持 workspace 1）。 */
  private assertWorkspace(workspaceId: number, actor: AuthenticatedActor): void {
    if (workspaceId !== 1) throw new BadRequestException('Only the default Workspace is available');
    if (actor.workspaceId !== workspaceId) throw new ForbiddenException('Workspace access denied');
  }

  /** 查找 Dataset 并校验 workspace 权限，未找到时抛出 NotFoundException。 */
  private async findDatasetOrThrow(
    workspaceId: number,
    datasetId: string,
    actor: AuthenticatedActor,
    client: DbClient = this.prisma,
  ) {
    this.assertWorkspace(workspaceId, actor);
    const dataset = await client.dataset.findUnique({
      where: { workspaceId_id: { workspaceId, id: datasetId } },
    });
    if (!dataset) throw new NotFoundException('Dataset not found');
    return dataset;
  }

  /** 操作者是否具有全局读取权限（管理员或持有 dataset.read_all / dataset.manage_all）。 */
  private hasGlobalRead(actor: AuthenticatedActor): boolean {
    return actor.isSystemAdmin || actor.isWorkspaceAdmin
      || actor.permissions.includes('dataset.read_all')
      || actor.permissions.includes('dataset.manage_all');
  }

  /** 根据 userId 查找对应的 WorkspaceMember 记录。 */
  private async findActorMember(
    workspaceId: number,
    userId: string,
    client: DbClient = this.prisma,
  ) {
    return client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
  }

  /**
   * 查找 Workspace owner 的 WorkspaceMember 记录。
   * 当系统管理员创建 Dataset 但并非 Workspace 成员时，回退使用此 owner。
   */
  private async findWorkspaceOwnerMember(workspaceId: number) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const member = await this.findActorMember(workspaceId, workspace.ownerUserId);
    if (!member) throw new ConflictException('Workspace owner membership is missing');
    return member;
  }

  /**
   * 确保移除或降级协作者不会使活跃 Dataset 失去全部 owner。
   * 已归档 Dataset 跳过此检查。
   */
  private async assertNotFinalOwner(
    tx: Prisma.TransactionClient,
    datasetId: string,
    workspaceMemberId: string,
  ): Promise<void> {
    const dataset = await tx.dataset.findUniqueOrThrow({ where: { id: datasetId } });
    if (dataset.status !== DatasetStatus.active) return;
    const otherOwners = await tx.datasetCollaborator.count({
      where: {
        datasetId,
        role: DatasetCollaboratorRole.owner,
        workspaceMemberId: { not: workspaceMemberId },
      },
    });
    if (otherOwners === 0) throw new ConflictException('An active Dataset must retain an owner');
  }

  private async incrementDatasetRevision(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    datasetId: string,
    expectedRevision: number,
    staleMessage: string,
    status?: DatasetStatus,
  ): Promise<void> {
    const result = await tx.dataset.updateMany({
      where: {
        id: datasetId,
        workspaceId,
        revision: expectedRevision,
        ...(status === undefined ? {} : { status }),
      },
      data: { revision: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException(staleMessage);
  }

  private async findActiveFieldIds(
    tx: Prisma.TransactionClient,
    datasetId: string,
    excludeFieldId?: string,
  ): Promise<string[]> {
    const fields = await tx.datasetField.findMany({
      where: {
        datasetId,
        archivedAt: null,
        ...(excludeFieldId && { id: { not: excludeFieldId } }),
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return fields.map((field) => field.id);
  }

  /** 将给定活跃字段顺序持久化为从 0 开始的连续 position。 */
  private async normalizeFieldPositions(
    tx: Prisma.TransactionClient,
    orderedIds: string[],
  ): Promise<void> {
    await Promise.all(orderedIds.map((id, position) => tx.datasetField.update({
      where: { id },
      data: { position },
    })));
  }

  /**
   * 校验关联字段配置：非关联字段不可设置关联元数据；
   * 关联字段必须提供合法的目标 Dataset 和基数。
   */
  private async assertRelationConfiguration(
    workspaceId: number,
    dto: CreateDatasetFieldInput,
  ): Promise<void> {
    if (dto.kind !== DatasetFieldKind.relation) {
      if (dto.relationTargetDatasetId || dto.relationCardinality) {
        throw new BadRequestException('Only relation fields may configure relation metadata');
      }
      return;
    }
    if (!dto.relationTargetDatasetId || !dto.relationCardinality) {
      throw new BadRequestException('Relation fields require a target Dataset and cardinality');
    }
    const target = await this.prisma.dataset.findUnique({
      where: { workspaceId_id: { workspaceId, id: dto.relationTargetDatasetId } },
    });
    if (!target || target.status !== DatasetStatus.active) {
      throw new BadRequestException('Relation target must be an active Dataset in this Workspace');
    }
  }

  /** 查找字段并验证其属于指定的 Dataset 和 Workspace。 */
  private async findField(workspaceId: number, datasetId: string, fieldId: string) {
    const field = await this.prisma.datasetField.findUnique({ where: { id: fieldId } });
    if (!field || field.workspaceId !== workspaceId || field.datasetId !== datasetId) {
      throw new NotFoundException('Dataset field not found');
    }
    return field;
  }

  private assertActive(status: DatasetStatus): void {
    if (status !== DatasetStatus.active) throw new ConflictException('Dataset is archived');
  }

  /**
   * 将 ConflictException 原样抛出；将 Prisma 唯一约束冲突（P2002）
   * 转换为带自定义消息的 ConflictException。
   */
  private rethrowUniqueConflict(error: unknown, message: string): never {
    if (error instanceof ConflictException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw error;
  }
}
