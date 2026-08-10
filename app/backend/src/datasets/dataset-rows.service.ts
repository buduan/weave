import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DatasetRowVersionOperation,
  DatasetStatus,
  DatasetType,
  Prisma,
} from '@prisma/client';

import type {
  AuthenticatedActor,
  DatasetFieldDefinition,
  DatasetRelationOptionPage,
  DatasetRowData,
  DatasetTableQuery,
  DatasetWindowQueryRequest,
  DatasetWindowQueryResponse,
} from '@weave/types';
import {
  applyDatasetQuery,
  createDatasetGroupDirectory,
  getDatasetAggregateOperations,
  getDatasetFilterOperators,
  getDatasetQueryFingerprint,
  isDatasetFieldGroupable,
  isDatasetQueryEmpty,
} from '@weave/utils';

import { AuditService } from '../audit/audit.service';
import { lockDatasetParent, lockDatasetRows } from '../common/aggregate-locks';
import { RelationValidationService } from '../common/relation-validation.service';
import { PrismaService } from '../prisma/prisma.service';
import { DatasetSchemaService, type ValidatedRowInput } from './dataset-schema.service';
import type { DatasetRowValuesInput, UpdateDatasetRowInput } from './dataset-input';
import { DatasetsService } from './datasets.service';

interface RelationFieldShape {
  id: string;
  relationTargetDatasetId: string | null;
}

/**
 * 管理 Dataset 数据行的 CRUD。
 * 每次变更（创建、更新、软删除、恢复）均在同一事务中：
 * 校验字段值 → 写入关联记录 → 创建不可变 DatasetRowVersion 快照 → 记录审计日志。
 */
@Injectable()
export class DatasetRowsService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly datasets: DatasetsService,
    private readonly schemas: DatasetSchemaService,
    private readonly audit: AuditService,
    private readonly relationValidation: RelationValidationService,
  ) {}

  /**
   * 游标分页列出未删除的行。
   * 多取一条用于判断是否存在下一页。
   */
  public async list(
    workspaceId: number,
    datasetId: string,
    actor: AuthenticatedActor,
    cursor?: string,
    take = 50,
  ) {
    await this.datasets.assertCanRead(workspaceId, datasetId, actor);
    const rows = await this.prisma.datasetRow.findMany({
      where: { workspaceId, datasetId, deletedAt: null },
      include: { sourceRelations: { orderBy: [{ fieldId: 'asc' }, { position: 'asc' }] } },
      orderBy: { id: 'asc' },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((row) => this.materialize(row)),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  }

  /** 查询绝对行窗口；空查询走数据库分页，复杂查询在明确的 5,000 行上限内复用共享语义。 */
  public async queryWindow(
    workspaceId: number,
    datasetId: string,
    request: DatasetWindowQueryRequest,
    actor: AuthenticatedActor,
  ): Promise<DatasetWindowQueryResponse> {
    const detail = await this.datasets.get(workspaceId, datasetId, actor);
    this.assertCompatibleQuery(detail.fields, request.query);
    const fingerprint = getDatasetQueryFingerprint({
      workspaceId,
      datasetId,
      definitionRevision: detail.dataset.revision,
    }, request.query);

    if (isDatasetQueryEmpty(request.query)) {
      const [totalRowCount, rows] = await Promise.all([
        this.prisma.datasetRow.count({
          where: { workspaceId, datasetId, deletedAt: null },
        }),
        this.prisma.datasetRow.findMany({
          where: { workspaceId, datasetId, deletedAt: null },
          include: { sourceRelations: { orderBy: [{ fieldId: 'asc' }, { position: 'asc' }] } },
          orderBy: { id: 'asc' },
          skip: request.window.offset,
          take: request.window.limit,
        }),
      ]);
      return {
        queryFingerprint: fingerprint,
        totalRowCount,
        startIndex: Math.min(request.window.offset, totalRowCount),
        items: rows.map((row) => this.materialize(row)),
        ...(request.includeGroupDirectory ? { groups: undefined } : {}),
      };
    }

    const activeRowCount = await this.prisma.datasetRow.count({
      where: { workspaceId, datasetId, deletedAt: null },
    });
    if (activeRowCount > 5_000) {
      throw new BadRequestException('Complex Dataset queries support at most 5,000 active rows');
    }
    const rows = await this.prisma.datasetRow.findMany({
      where: { workspaceId, datasetId, deletedAt: null },
      include: { sourceRelations: { orderBy: [{ fieldId: 'asc' }, { position: 'asc' }] } },
      orderBy: { id: 'asc' },
    });
    const queriedRows = applyDatasetQuery(
      rows.map((row) => this.materialize(row)),
      detail.fields,
      request.query,
    );
    const startIndex = Math.min(request.window.offset, queriedRows.length);
    return {
      queryFingerprint: fingerprint,
      totalRowCount: queriedRows.length,
      startIndex,
      items: queriedRows.slice(startIndex, startIndex + request.window.limit),
      ...(request.includeGroupDirectory
        ? { groups: createDatasetGroupDirectory(queriedRows, detail.fields, request.query) }
        : {}),
    };
  }

  /** 查询关联字段的目标行选项，同时保留已选中但不在当前分页中的值。 */
  public async relationOptions(
    workspaceId: number,
    datasetId: string,
    fieldId: string,
    actor: AuthenticatedActor,
    options: { cursor?: string; limit: number; search?: string; selectedIds: string[] },
  ): Promise<DatasetRelationOptionPage> {
    const source = await this.datasets.get(workspaceId, datasetId, actor);
    const field = source.fields.find((item) => item.id === fieldId);
    if (!field || field.kind !== 'relation' || !field.relationTargetDatasetId) {
      throw new NotFoundException('Relation field not found');
    }
    const target = await this.datasets.get(
      workspaceId,
      field.relationTargetDatasetId,
      actor,
    );
    const configuredLabelFieldId = typeof field.config.labelFieldId === 'string'
      ? field.config.labelFieldId
      : null;
    const labelField = target.fields.find((item) => (
      item.id === configuredLabelFieldId && item.kind !== 'relation'
    ));
    const baseWhere: Prisma.DatasetRowWhereInput = {
      workspaceId,
      datasetId: target.dataset.id,
      deletedAt: null,
    };
    const search = options.search?.trim();
    const where: Prisma.DatasetRowWhereInput = search
      ? {
        ...baseWhere,
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          ...(labelField ? [{
            values: {
              path: [labelField.id],
              string_contains: search,
              mode: 'insensitive' as const,
            },
          }] : []),
        ],
      }
      : baseWhere;
    const [pageRowsWithExtra, selectedRows] = await Promise.all([
      this.prisma.datasetRow.findMany({
        where,
        select: { id: true, values: true },
        orderBy: { id: 'asc' },
        take: options.limit + 1,
        ...(options.cursor && { cursor: { id: options.cursor }, skip: 1 }),
      }),
      options.selectedIds.length > 0
        ? this.prisma.datasetRow.findMany({
          where: { ...baseWhere, id: { in: options.selectedIds } },
          select: { id: true, values: true },
          orderBy: { id: 'asc' },
        })
        : Promise.resolve([]),
    ]);
    const hasMore = pageRowsWithExtra.length > options.limit;
    const pageRows = hasMore
      ? pageRowsWithExtra.slice(0, options.limit)
      : pageRowsWithExtra;
    const optionRows = [...pageRows, ...selectedRows].map((row) => {
      const values = row.values as Prisma.JsonObject;
      const labelValue = labelField ? values[labelField.id] : undefined;
      return {
        label: typeof labelValue === 'string' && labelValue.trim() ? labelValue : row.id,
        value: row.id,
      };
    });
    const items = [...new Map(optionRows.map((item) => [item.value, item])).values()];
    return {
      items,
      nextCursor: hasMore ? pageRows.at(-1)?.id ?? null : null,
    };
  }

  /** 获取单行，含合并后的关联关系。 */
  public async get(
    workspaceId: number,
    datasetId: string,
    rowId: string,
    actor: AuthenticatedActor,
  ) {
    await this.datasets.assertCanRead(workspaceId, datasetId, actor);
    const row = await this.prisma.datasetRow.findUnique({
      where: { workspaceId_datasetId_id: { workspaceId, datasetId, id: rowId } },
      include: { sourceRelations: { orderBy: [{ fieldId: 'asc' }, { position: 'asc' }] } },
    });
    if (!row) throw new NotFoundException('Dataset row not found');
    return this.materialize(row);
  }

  /**
   * 创建新行。值经过活跃字段 Schema 校验；
   * 关联目标验证存在于正确的 Dataset 中。
   */
  public async create(
    workspaceId: number,
    datasetId: string,
    dto: DatasetRowValuesInput,
    actor: AuthenticatedActor,
  ) {
    await this.datasets.assertCanCreateRows(workspaceId, datasetId, actor);
    return this.prisma.$transaction(async (tx) => {
      await lockDatasetParent(tx, datasetId, 'share');
      await this.assertCurrentDatasetState(tx, workspaceId, datasetId, 'create');
      const fields = await tx.datasetField.findMany({ where: { datasetId } });
      const validated = this.schemas.validateRow(fields, dto);
      await this.relationValidation.validate(tx, workspaceId, fields, validated.relations);
      const row = await tx.datasetRow.create({
        data: {
          workspaceId,
          datasetId,
          values: validated.values,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.writeRelations(tx, workspaceId, datasetId, row.id, fields, validated.relations);
      // 保存行的初始快照。
      const relationsSnapshot = this.relationsSnapshot(validated.relations);
      const version = await tx.datasetRowVersion.create({
        data: {
          rowId: row.id,
          version: row.revision,
          operation: DatasetRowVersionOperation.create,
          valuesSnapshot: validated.values,
          relationsSnapshot,
          changedFieldIds: [...Object.keys(dto.values), ...Object.keys(dto.relations)],
          actorUserId: actor.userId,
        },
      });
      await this.audit.record({
        action: 'dataset.row.create',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'dataset_row',
        resourceId: row.id,
        result: 'success',
        workspaceId,
        metadata: { datasetId, rowVersionId: version.id },
      }, tx);
      return this.materialize({ ...row, sourceRelations: this.fakeRelations(validated.relations) });
    });
  }

  /**
   * 更新行。采用乐观锁（expectedRevision）防止并发覆盖。
   * 已删除的行需要先恢复再更新。
   * 仅更新传入的字段；未传字段保持原值。关联字段先删后插以更新目标。
   */
  public async update(
    workspaceId: number,
    datasetId: string,
    rowId: string,
    dto: UpdateDatasetRowInput,
    actor: AuthenticatedActor,
  ) {
    await this.datasets.assertCanUpdateRows(workspaceId, datasetId, actor);
    return this.prisma.$transaction(async (tx) => {
      await lockDatasetParent(tx, datasetId, 'share');
      await this.assertCurrentDatasetState(tx, workspaceId, datasetId, 'update');
      const fields = await tx.datasetField.findMany({ where: { datasetId } });
      const initialRow = await tx.datasetRow.findUnique({
        where: { workspaceId_datasetId_id: { workspaceId, datasetId, id: rowId } },
      });
      if (!initialRow) throw new NotFoundException('Dataset row not found');
      const initialValidated = this.schemas.validateRow(
        fields,
        dto,
        initialRow.values as Prisma.JsonObject,
        true,
      );
      await this.relationValidation.validate(
        tx,
        workspaceId,
        fields,
        initialValidated.relations,
        { updateRowIds: [rowId] },
      );
      const row = await this.findRowWithSourceRelations(tx, workspaceId, datasetId, rowId);
      if (row.deletedAt) {
        throw new ConflictException('Deleted Dataset row must be restored before update');
      }
      const validated = this.schemas.validateRow(
        fields,
        dto,
        row.values as Prisma.JsonObject,
        true,
      );
      const resultingRelations = this.mergeRelations(row.sourceRelations, validated.relations);
      const result = await tx.datasetRow.updateMany({
        where: {
          id: rowId, workspaceId, datasetId, revision: dto.expectedRevision, deletedAt: null,
        },
        data: {
          values: validated.values,
          revision: { increment: 1 },
          updatedByUserId: actor.userId,
        },
      });
      if (result.count !== 1) throw new ConflictException('Dataset row revision is stale');
      if (validated.relations.size > 0) {
        const fieldIds = [...validated.relations.keys()];
        await tx.datasetRelation.deleteMany({
          where: { sourceRowId: rowId, fieldId: { in: fieldIds } },
        });
        await this.writeRelations(tx, workspaceId, datasetId, rowId, fields, validated.relations);
      }
      const updated = await tx.datasetRow.findUniqueOrThrow({ where: { id: rowId } });
      const version = await tx.datasetRowVersion.create({
        data: {
          rowId,
          version: updated.revision,
          operation: DatasetRowVersionOperation.update,
          valuesSnapshot: validated.values,
          relationsSnapshot: this.relationsSnapshot(resultingRelations),
          changedFieldIds: [...Object.keys(dto.values), ...Object.keys(dto.relations)],
          actorUserId: actor.userId,
        },
      });
      await this.audit.record({
        action: 'dataset.row.update',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'dataset_row',
        resourceId: rowId,
        result: 'success',
        workspaceId,
        metadata: { datasetId, rowVersionId: version.id },
      }, tx);
      return this.materialize({
        ...updated,
        sourceRelations: this.fakeRelations(resultingRelations),
      });
    });
  }

  /**
   * 软删除行。被其他行关联引用的行不允许删除，防止悬空引用。
   */
  public async softDelete(
    workspaceId: number,
    datasetId: string,
    rowId: string,
    expectedRevision: number,
    actor: AuthenticatedActor,
  ) {
    await this.datasets.assertCanDeleteRows(workspaceId, datasetId, actor);
    return this.prisma.$transaction(async (tx) => {
      await lockDatasetParent(tx, datasetId, 'share');
      await this.assertCurrentDatasetState(tx, workspaceId, datasetId, 'delete');
      await lockDatasetRows(tx, [rowId], 'update');
      const row = await this.findRowWithSourceRelations(tx, workspaceId, datasetId, rowId);
      const incoming = await tx.datasetRelation.count({ where: { targetRowId: rowId } });
      if (incoming > 0) throw new ConflictException('Dataset row is referenced by another row');
      const result = await tx.datasetRow.updateMany({
        where: {
          id: rowId, workspaceId, datasetId, revision: expectedRevision, deletedAt: null,
        },
        data: { deletedAt: new Date(), revision: { increment: 1 }, updatedByUserId: actor.userId },
      });
      if (result.count !== 1) throw new ConflictException('Dataset row revision is stale or deleted');
      const updated = await tx.datasetRow.findUniqueOrThrow({ where: { id: rowId } });
      const relations = this.mergeRelations(row.sourceRelations, new Map());
      const version = await tx.datasetRowVersion.create({
        data: {
          rowId,
          version: updated.revision,
          operation: DatasetRowVersionOperation.delete,
          valuesSnapshot: updated.values as Prisma.InputJsonObject,
          relationsSnapshot: this.relationsSnapshot(relations),
          changedFieldIds: [],
          actorUserId: actor.userId,
        },
      });
      await this.audit.record({
        action: 'dataset.row.delete',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'dataset_row',
        resourceId: rowId,
        result: 'success',
        workspaceId,
        metadata: { datasetId, rowVersionId: version.id },
      }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /**
   * 从历史版本快照恢复已软删除的行。
   * 恢复前会用当前字段定义重新校验快照数据；
   * 若与当前定义不兼容则拒绝恢复并返回具体冲突原因。
   */
  public async restore(
    workspaceId: number,
    datasetId: string,
    rowId: string,
    versionId: string,
    expectedRevision: number,
    actor: AuthenticatedActor,
  ) {
    const dataset = await this.datasets.assertCanManage(workspaceId, datasetId, actor);
    this.assertActive(dataset.status);
    return this.prisma.$transaction(async (tx) => {
      await lockDatasetParent(tx, datasetId, 'share');
      await this.assertCurrentDatasetState(tx, workspaceId, datasetId, 'restore');
      const [snapshot, fields] = await Promise.all([
        tx.datasetRowVersion.findUnique({ where: { id: versionId } }),
        tx.datasetField.findMany({ where: { datasetId } }),
      ]);
      if (!snapshot || snapshot.rowId !== rowId) {
        throw new NotFoundException('Dataset row or version not found');
      }
      const relationsObject = this.asRelationsObject(snapshot.relationsSnapshot);
      let validated: ValidatedRowInput;
      try {
        validated = this.schemas.validateRow(
          fields.map((field) => ({ ...field, isSystemManaged: false })),
          {
            values: snapshot.valuesSnapshot as Record<string, unknown>,
            relations: relationsObject,
          },
        );
        await this.relationValidation.validate(
          tx,
          workspaceId,
          fields,
          validated.relations,
          { updateRowIds: [rowId] },
        );
      } catch (error) {
        throw new ConflictException({
          message: 'Historical row is incompatible with the current Dataset definition',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      const row = await tx.datasetRow.findUnique({
        where: { workspaceId_datasetId_id: { workspaceId, datasetId, id: rowId } },
      });
      if (!row) throw new NotFoundException('Dataset row or version not found');
      if (!row.deletedAt) throw new ConflictException('Dataset row is not deleted');
      const result = await tx.datasetRow.updateMany({
        where: {
          id: rowId, workspaceId, datasetId, revision: expectedRevision, deletedAt: { not: null },
        },
        data: {
          values: validated.values,
          deletedAt: null,
          revision: { increment: 1 },
          updatedByUserId: actor.userId,
        },
      });
      if (result.count !== 1) throw new ConflictException('Dataset row revision is stale or active');
      // 清空旧关联并写入恢复后的关联数据。
      await tx.datasetRelation.deleteMany({ where: { sourceRowId: rowId } });
      await this.writeRelations(tx, workspaceId, datasetId, rowId, fields, validated.relations);
      const updated = await tx.datasetRow.findUniqueOrThrow({ where: { id: rowId } });
      const version = await tx.datasetRowVersion.create({
        data: {
          rowId,
          version: updated.revision,
          operation: DatasetRowVersionOperation.restore,
          valuesSnapshot: validated.values,
          relationsSnapshot: this.relationsSnapshot(validated.relations),
          changedFieldIds: [
            ...Object.keys(snapshot.valuesSnapshot as object),
            ...validated.relations.keys(),
          ],
          actorUserId: actor.userId,
        },
      });
      await this.audit.record({
        action: 'dataset.row.restore',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'dataset_row',
        resourceId: rowId,
        result: 'success',
        workspaceId,
        metadata: {
          datasetId,
          restoredFromVersionId: versionId,
          rowVersionId: version.id,
        },
      }, tx);
      return this.materialize({
        ...updated,
        sourceRelations: this.fakeRelations(validated.relations),
      });
    });
  }

  private assertCompatibleQuery(
    fields: DatasetFieldDefinition[],
    query: DatasetTableQuery,
  ): void {
    const fieldsById = new Map(fields.map((field) => [field.id, field]));
    query.filters.forEach((rule) => {
      const field = fieldsById.get(rule.fieldId);
      const compatible = field && getDatasetFilterOperators(field)
        .some((option) => option.value === rule.operator);
      if (!compatible) throw new BadRequestException(`Incompatible filter field: ${rule.fieldId}`);
    });
    query.sorts.forEach((rule) => {
      if (!fieldsById.has(rule.fieldId)) {
        throw new BadRequestException(`Unknown sort field: ${rule.fieldId}`);
      }
    });
    if (!query.group) return;
    const groupField = fieldsById.get(query.group.fieldId);
    if (!groupField || !isDatasetFieldGroupable(groupField)) {
      throw new BadRequestException(`Incompatible group field: ${query.group.fieldId}`);
    }
    query.group.aggregates.forEach((rule) => {
      const field = fieldsById.get(rule.fieldId);
      if (!field || !getDatasetAggregateOperations(field).includes(rule.operation)) {
        throw new BadRequestException(`Incompatible aggregate field: ${rule.fieldId}`);
      }
    });
  }

  private async assertCurrentDatasetState(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    datasetId: string,
    operation: 'create' | 'delete' | 'restore' | 'update',
  ): Promise<void> {
    const dataset = await tx.dataset.findUnique({ where: { id: datasetId } });
    if (!dataset || dataset.workspaceId !== workspaceId) {
      throw new NotFoundException('Dataset not found');
    }
    if (dataset.status !== DatasetStatus.active) throw new ConflictException('Dataset is archived');
    const compatible = operation === 'update'
      ? dataset.type === DatasetType.standard || dataset.type === DatasetType.members
      : operation === 'restore'
        ? dataset.type !== DatasetType.activity_registrations
        : dataset.type === DatasetType.standard;
    if (!compatible) throw new ConflictException(`Dataset type does not allow row ${operation}`);
  }

  private async findRowWithSourceRelations(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    datasetId: string,
    rowId: string,
  ) {
    const row = await tx.datasetRow.findUnique({
      where: { workspaceId_datasetId_id: { workspaceId, datasetId, id: rowId } },
      include: { sourceRelations: true },
    });
    if (!row) throw new NotFoundException('Dataset row not found');
    return row;
  }

  /**
   * 将关联关系批量写入 DatasetRelation 表。
   * 每条记录包含源行、目标行、字段 ID、目标 Dataset 及排序位置。
   */
  private async writeRelations(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    sourceDatasetId: string,
    sourceRowId: string,
    fields: RelationFieldShape[],
    relations: Map<string, string[]>,
  ): Promise<void> {
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const data = [...relations.entries()].flatMap(([fieldId, targets]) => (
      targets.map((targetRowId, position) => ({
        workspaceId,
        sourceDatasetId,
        sourceRowId,
        fieldId,
        targetDatasetId: fieldMap.get(fieldId)!.relationTargetDatasetId!,
        targetRowId,
        position,
      }))
    ));
    if (data.length > 0) await tx.datasetRelation.createMany({ data });
  }

  /**
   * 合并新旧关联关系：传入字段替换旧值，未传入字段保留旧值。
   * 用于部分更新场景。
   */
  private mergeRelations(
    existing: Array<{ fieldId: string; position: number; targetRowId: string }>,
    replacements: Map<string, string[]>,
  ): Map<string, string[]> {
    const result = new Map<string, string[]>();
    existing.sort((left, right) => left.position - right.position).forEach((relation) => {
      if (!replacements.has(relation.fieldId)) {
        result.set(relation.fieldId, [
          ...(result.get(relation.fieldId) ?? []),
          relation.targetRowId,
        ]);
      }
    });
    replacements.forEach((targets, fieldId) => result.set(fieldId, targets));
    return result;
  }

  /** 将关联 Map 转为普通 JSON 对象，供行版本快照存储。 */
  private relationsSnapshot(relations: Map<string, string[]>): Prisma.InputJsonObject {
    return Object.fromEntries(relations) as Prisma.InputJsonObject;
  }

  /** 将 JSONB 中存储的关联快照还原为普通对象。 */
  private asRelationsObject(value: Prisma.JsonValue): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConflictException('Historical relation snapshot is invalid');
    }
    return value as Record<string, unknown>;
  }

  /**
   * 将关联 Map 展开为扁平的 { fieldId, targetRowId, position } 数组，
   * 用于在未持久化关联时临时拼装读模型。
   */
  private fakeRelations(relations: Map<string, string[]>) {
    return [...relations.entries()].flatMap(([fieldId, targets]) => (
      targets.map((targetRowId, position) => ({ fieldId, targetRowId, position }))
    ));
  }

  /**
   * 将数据库行和关联记录合并为对外读模型。
   * 单值关联展开为字符串，多值关联保持为数组。
   */
  private materialize(row: {
    createdAt: Date;
    datasetId: string;
    deletedAt: Date | null;
    id: string;
    revision: number;
    sourceRelations: Array<{ fieldId: string; position: number; targetRowId: string }>;
    updatedAt: Date;
    values: Prisma.JsonValue;
  }): DatasetRowData {
    const grouped = this.mergeRelations(row.sourceRelations, new Map());
    return {
      id: row.id,
      datasetId: row.datasetId,
      values: row.values as DatasetRowData['values'],
      relations: Object.fromEntries([...grouped.entries()].map(([fieldId, targets]) => [
        fieldId,
        targets.length === 1 ? targets[0] : targets,
      ])),
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  private assertActive(status: DatasetStatus): void {
    if (status !== DatasetStatus.active) throw new ConflictException('Dataset is archived');
  }
}
