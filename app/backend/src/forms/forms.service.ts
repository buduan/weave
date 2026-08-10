import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DatasetFieldKind,
  DatasetStatus,
  type Dataset,
  type Form,
  type FormVersion,
  FormStatus,
  FormVersionState,
  Prisma,
} from '@prisma/client';

import type {
  AcquireFormEditLockResult,
  AuthenticatedActor,
  CreateFormResult,
  FormCreatorSummary,
  FormEditLockSummary,
  FormListSection,
  FormPanelDetail,
  FormPanelSummary,
  FormRelationOption,
  FormSummary,
  FormVersionDefinition,
  HeartbeatFormEditLockResult,
  JsonSchema,
  JsonValue,
  PublishedFormDefinition,
  ReleaseFormEditLockResult,
} from '@weave/types';
import {
  checksumJson,
  evaluateFormAnswers,
  evaluateRelationFilter,
  normalizeFormSchemaPositions,
  parseFormSchema,
  projectCurrentFormFields,
  resolveLocalizedText,
} from '@weave/utils';

import { AuditService } from '../audit/audit.service';
import { lockDatasetParent, lockFormParent } from '../common/aggregate-locks';
import { DatasetsService } from '../datasets/datasets.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FormDefinitionValidatorService } from './form-definition-validator.service';
import type {
  CreateFormInput,
  UpdateFormDraftInput,
} from './form-input';

/** Form 版本定义的内部接口，供 versionData 复用。 */
interface VersionDefinitionInput {
  closesAt?: string;
  closingMessageI18n?: Record<string, string>;
  defaultLocale: string;
  descriptionI18n?: Record<string, string>;
  nameI18n: Record<string, string>;
  opensAt?: string;
  schema: Record<string, unknown>;
  submissionAccess: CreateFormInput['submissionAccess'];
  writeMode: CreateFormInput['writeMode'];
}

interface FormEditLockRecord {
  holderName: string;
  lockedAt: string;
  token: string;
  userId: string;
}

const editLockTtlSeconds = 90;
const formStatusTransitions: Record<FormStatus, readonly FormStatus[]> = {
  [FormStatus.active]: [FormStatus.closed, FormStatus.archived],
  [FormStatus.closed]: [FormStatus.active, FormStatus.archived],
  [FormStatus.archived]: [FormStatus.active],
};

function formStatusesAllowing(status: FormStatus): FormStatus[] {
  return Object.values(FormStatus)
    .filter((previousStatus) => formStatusTransitions[previousStatus].includes(status));
}

const panelFormInclude = Prisma.validator<Prisma.FormInclude>()({
  activeVersion: true,
  createdBy: {
    select: {
      id: true,
      name: true,
      nickname: true,
      username: true,
    },
  },
  versions: {
    where: { state: FormVersionState.draft },
    orderBy: { version: 'desc' },
    take: 1,
  },
});

type PanelFormRecord = Prisma.FormGetPayload<{ include: typeof panelFormInclude }>;

/** 设备信息采集的固定定义：采集键 → 系统字段 key 和名称。 */
const captureDefinitions = {
  browser: { key: 'device_browser', name: 'Browser' },
  operatingSystem: { key: 'device_operating_system', name: 'Operating system' },
  userAgent: { key: 'device_user_agent', name: 'User-Agent' },
} as const;

/**
 * Form 管理服务。
 * 负责 Form 的创建、草稿更新、发布、状态变更、公开版本获取和关联选项查询。
 * 权限遵循 Dataset 模型：owner/maintainer 可管理 Form。
 */
@Injectable()
export class FormsService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly datasets: DatasetsService,
    private readonly validator: FormDefinitionValidatorService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 列出当前操作者可见的 Form。
   * 持有 form.manage_all 权限的用户看到全部；
   * 其他用户只看到其可读 Dataset 下的 Form。
   */
  public async list(
    workspaceId: number,
    actor: AuthenticatedActor,
    section: FormListSection = 'main',
  ): Promise<FormPanelSummary[]> {
    if (actor.workspaceId !== workspaceId) throw new NotFoundException('Workspace not found');
    const datasetIds = actor.permissions.includes('form.manage_all')
      ? undefined
      : (await this.datasets.list(workspaceId, actor)).items.map((dataset) => dataset.id);
    let status: Prisma.EnumFormStatusFilter | FormStatus | undefined;
    if (section === 'main') status = { in: [FormStatus.active, FormStatus.closed] };
    if (section === 'archived') status = FormStatus.archived;
    const forms = await this.prisma.form.findMany({
      where: {
        workspaceId,
        ...(datasetIds && { datasetId: { in: datasetIds } }),
        ...(status && { status }),
      },
      include: panelFormInclude,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const locks = forms.length === 0
      ? []
      : await this.redis.mget(forms.map((form) => this.editLockKey(workspaceId, form.id)));
    return forms.map((form, index) => this.toPanelSummary(
      form,
      this.toLockSummary(this.parseLock(locks[index] ?? null)),
    ));
  }

  /** 获取单个 Form，含最新草稿和当前活跃发布版本。 */
  public async get(
    workspaceId: number,
    formId: string,
    actor: AuthenticatedActor,
  ): Promise<FormPanelDetail> {
    const form = await this.findForm(workspaceId, formId);
    if (!actor.permissions.includes('form.manage_all')) {
      await this.datasets.assertCanRead(workspaceId, form.datasetId, actor);
    }
    const detail = await this.prisma.form.findUniqueOrThrow({
      where: { id: formId },
      include: panelFormInclude,
    });
    const lock = this.parseLock(await this.redis.get(this.editLockKey(workspaceId, formId)));
    return {
      ...this.toFormSummary(detail),
      creator: this.toCreatorSummary(detail.createdBy),
      draft: detail.versions[0] ? this.toVersionDefinition(detail.versions[0]) : null,
      release: detail.activeVersion
        ? this.toVersionDefinition(detail.activeVersion)
        : null,
      lock: this.toLockSummary(lock),
    };
  }

  /**
   * 创建 Form 及其首个草稿版本。
   * 同时处理设备信息采集字段的自动创建（若 Schema 中启用）。
   */
  public async create(
    workspaceId: number,
    dto: CreateFormInput,
    actor: AuthenticatedActor,
  ): Promise<CreateFormResult> {
    const dataset = await this.findManagedDataset(workspaceId, dto.datasetId, actor);
    if (dataset.status !== DatasetStatus.active) throw new ConflictException('Dataset is archived');
    this.validateMetadata(dto);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await lockDatasetParent(
          tx,
          dataset.id,
          this.hasCaptureConfiguration(dto.schema) ? 'update' : 'share',
        );
        const currentDataset = await tx.dataset.findUnique({ where: { id: dataset.id } });
        if (!currentDataset
          || currentDataset.workspaceId !== workspaceId
          || currentDataset.status !== DatasetStatus.active) {
          throw new ConflictException('Dataset is archived or changed concurrently');
        }
        const { schema, checksum } = await this.prepareFormSchema(
          tx,
          currentDataset,
          dto,
          actor.userId,
        );
        const form = await tx.form.create({
          data: {
            workspaceId,
            datasetId: dataset.id,
            slug: dto.slug,
            createdByUserId: actor.userId,
          },
        });
        const version = await tx.formVersion.create({
          data: {
            formId: form.id,
            version: 1,
            state: FormVersionState.draft,
            ...this.versionData(dto, schema, checksum),
            createdByUserId: actor.userId,
          },
        });
        await this.audit.record({
          action: 'form.create',
          actorType: 'user',
          actorUserId: actor.userId,
          resourceType: 'form',
          resourceId: form.id,
          result: 'success',
          workspaceId,
          metadata: { datasetId: dataset.id, versionId: version.id },
        }, tx);
        return { form, version };
      });
      return {
        form: this.toFormSummary(created.form),
        draft: this.toVersionDefinition(created.version),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Form slug is already in use');
      }
      throw error;
    }
  }

  /**
   * 更新 Form 草稿。
   * 若最新版本已是草稿 → 原地更新（CAS 乐观锁）；
   * 若最新版本已发布 → 创建新版本号的新草稿。
   */
  public async updateDraft(
    workspaceId: number,
    formId: string,
    dto: UpdateFormDraftInput,
    actor: AuthenticatedActor,
    lockToken: string,
  ): Promise<FormVersionDefinition> {
    const form = await this.findForm(workspaceId, formId);
    const dataset = await this.findManagedDataset(workspaceId, form.datasetId, actor);
    if (form.status === FormStatus.archived || dataset.status !== DatasetStatus.active) {
      throw new ConflictException('Form or Dataset is archived');
    }
    await this.assertEditLock(workspaceId, formId, lockToken, actor.userId);
    this.validateMetadata(dto);
    const saved = await this.prisma.$transaction(async (tx) => {
      await lockDatasetParent(tx, dataset.id, 'update');
      await lockFormParent(tx, formId, 'update');
      const { currentDataset } = await this.findCurrentFormDataset(
        tx,
        workspaceId,
        dataset.id,
        formId,
        undefined,
        'Form or Dataset is archived or changed concurrently',
      );
      const { schema, checksum } = await this.prepareFormSchema(
        tx,
        currentDataset,
        dto,
        actor.userId,
      );
      const latest = await tx.formVersion.findFirst({
        where: { formId },
        orderBy: { version: 'desc' },
      });
      if (!latest) throw new ConflictException('Form draft is missing');
      let version;
      if (latest.state === FormVersionState.draft) {
        // 原地更新已有草稿。
        const result = await tx.formVersion.updateMany({
          where: { id: latest.id, state: FormVersionState.draft, revision: dto.expectedRevision },
          data: {
            ...this.versionData(dto, schema, checksum),
            revision: { increment: 1 },
          },
        });
        if (result.count !== 1) throw new ConflictException('Form draft revision is stale');
        version = await tx.formVersion.findUniqueOrThrow({ where: { id: latest.id } });
      } else {
        // 基于已发布版本创建新草稿。
        if (latest.revision !== dto.expectedRevision) {
          throw new ConflictException('Form version revision is stale');
        }
        version = await tx.formVersion.create({
          data: {
            formId,
            version: latest.version + 1,
            state: FormVersionState.draft,
            ...this.versionData(dto, schema, checksum),
            createdByUserId: actor.userId,
          },
        });
      }
      await tx.form.update({ where: { id: formId }, data: { revision: { increment: 1 } } });
      await this.audit.record({
        action: 'form.draft.update',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'form_version',
        resourceId: version.id,
        result: 'success',
        workspaceId,
        metadata: { formId, revision: version.revision },
      }, tx);
      return version;
    });
    return this.toVersionDefinition(saved);
  }

  /**
   * 发布 Form 草稿。
   * 发布后版本变为不可变 published 状态；原活跃版本被标记为 retired。
   * Form 的 activeVersionId 指针在事务内更新。
   */
  public async publish(
    workspaceId: number,
    formId: string,
    expectedRevision: number,
    actor: AuthenticatedActor,
    lockToken: string,
  ): Promise<FormVersionDefinition> {
    const form = await this.findForm(workspaceId, formId);
    const dataset = await this.findManagedDataset(workspaceId, form.datasetId, actor);
    if (form.status !== FormStatus.active || dataset.status !== DatasetStatus.active) {
      throw new ConflictException('Form and Dataset must be active');
    }
    await this.assertEditLock(workspaceId, formId, lockToken, actor.userId);
    const published = await this.prisma.$transaction(async (tx) => {
      await lockDatasetParent(tx, dataset.id, 'share');
      await lockFormParent(tx, formId, 'update');
      const { currentDataset, currentForm } = await this.findCurrentFormDataset(
        tx,
        workspaceId,
        dataset.id,
        formId,
        FormStatus.active,
        'Form and Dataset must be active and consistently bound',
      );
      const draft = await tx.formVersion.findFirst({
        where: { formId, state: FormVersionState.draft },
        orderBy: { version: 'desc' },
      });
      if (!draft) throw new ConflictException('Form has no draft to publish');
      // 发布前再次校验元数据和 Schema 完整性。
      this.validateMetadata({
        defaultLocale: draft.defaultLocale,
        nameI18n: draft.nameI18n as Record<string, string>,
        descriptionI18n: draft.descriptionI18n as Record<string, string> | undefined,
        closingMessageI18n: draft.closingMessageI18n as Record<string, string> | undefined,
        opensAt: draft.opensAt?.toISOString(),
        closesAt: draft.closesAt?.toISOString(),
      });
      await this.validateDefinition(
        tx,
        currentDataset,
        draft.schema as Record<string, unknown>,
        draft,
      );
      const result = await tx.formVersion.updateMany({
        where: { id: draft.id, state: FormVersionState.draft, revision: expectedRevision },
        data: {
          state: FormVersionState.published,
          publishedAt: new Date(),
          publishedByUserId: actor.userId,
        },
      });
      if (result.count !== 1) throw new ConflictException('Form draft revision is stale');
      // 将旧活跃版本标记为 retired。
      if (currentForm.activeVersionId) {
        await tx.formVersion.update({
          where: { id: currentForm.activeVersionId },
          data: { state: FormVersionState.retired },
        });
      }
      await tx.form.update({
        where: { id: formId },
        data: { activeVersionId: draft.id, revision: { increment: 1 } },
      });
      await this.audit.record({
        action: 'form.publish',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'form_version',
        resourceId: draft.id,
        result: 'success',
        workspaceId,
        metadata: { formId, version: draft.version },
      }, tx);
      return tx.formVersion.findUniqueOrThrow({ where: { id: draft.id } });
    });
    return this.toVersionDefinition(published);
  }

  public close(
    workspaceId: number,
    formId: string,
    expectedRevision: number,
    actor: AuthenticatedActor,
  ) {
    return this.changeStatus(
      workspaceId,
      formId,
      expectedRevision,
      FormStatus.closed,
      actor,
      [FormStatus.active],
    );
  }

  public reopen(
    workspaceId: number,
    formId: string,
    expectedRevision: number,
    actor: AuthenticatedActor,
  ) {
    return this.changeStatus(
      workspaceId,
      formId,
      expectedRevision,
      FormStatus.active,
      actor,
      [FormStatus.closed],
    );
  }

  public archive(
    workspaceId: number,
    formId: string,
    expectedRevision: number,
    actor: AuthenticatedActor,
  ) {
    return this.changeStatus(
      workspaceId,
      formId,
      expectedRevision,
      FormStatus.archived,
      actor,
      [FormStatus.active, FormStatus.closed],
    );
  }

  public restore(
    workspaceId: number,
    formId: string,
    expectedRevision: number,
    actor: AuthenticatedActor,
  ) {
    return this.changeStatus(
      workspaceId,
      formId,
      expectedRevision,
      FormStatus.active,
      actor,
      [FormStatus.archived],
    );
  }

  /** 按显式状态机变更 Form 状态，并与提交共享 Dataset → Form 锁序。 */
  public async changeStatus(
    workspaceId: number,
    formId: string,
    expectedRevision: number,
    status: FormStatus,
    actor: AuthenticatedActor,
    allowedPreviousStatuses = formStatusesAllowing(status),
  ) {
    const form = await this.findForm(workspaceId, formId);
    await this.findManagedDataset(workspaceId, form.datasetId, actor);
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockDatasetParent(tx, form.datasetId, 'share');
      await lockFormParent(tx, formId, 'update');
      const [currentDataset, currentForm] = await Promise.all([
        tx.dataset.findUnique({ where: { id: form.datasetId } }),
        tx.form.findUnique({ where: { id: formId } }),
      ]);
      if (!currentDataset
        || currentDataset.workspaceId !== workspaceId
        || !currentForm
        || currentForm.workspaceId !== workspaceId
        || currentForm.datasetId !== currentDataset.id) {
        throw new ConflictException('Form and Dataset binding changed concurrently');
      }
      if (currentForm.revision !== expectedRevision) {
        throw new ConflictException('Form revision is stale');
      }
      if (!formStatusTransitions[currentForm.status].includes(status)
        || !allowedPreviousStatuses.includes(currentForm.status)) {
        throw new ConflictException(
          `Form cannot transition from ${currentForm.status} to ${status}`,
        );
      }
      const result = await tx.form.updateMany({
        where: {
          id: formId,
          workspaceId,
          revision: expectedRevision,
          status: currentForm.status,
        },
        data: { status, revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new ConflictException('Form revision is stale');
      await this.audit.record({
        action: 'form.status.update',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'form',
        resourceId: formId,
        result: 'success',
        workspaceId,
        metadata: { previousStatus: currentForm.status, status },
      }, tx);
      return tx.form.findUniqueOrThrow({ where: { id: formId } });
    });
    if (status === FormStatus.archived) {
      await this.redis.del(this.editLockKey(workspaceId, formId));
    }
    return this.toFormSummary(updated);
  }

  /** 为单个编辑会话获取 Redis TTL 锁。 */
  public async acquireEditLock(
    workspaceId: number,
    formId: string,
    actor: AuthenticatedActor,
  ): Promise<AcquireFormEditLockResult> {
    const form = await this.findForm(workspaceId, formId);
    await this.findManagedDataset(workspaceId, form.datasetId, actor);
    if (form.status === FormStatus.archived) throw new ConflictException('Form is archived');

    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true, nickname: true, username: true },
    });
    const token = randomUUID();
    const record: FormEditLockRecord = {
      userId: actor.userId,
      holderName: user?.nickname || user?.name || user?.username || actor.userId,
      lockedAt: new Date().toISOString(),
      token,
    };
    const key = this.editLockKey(workspaceId, formId);
    const acquired = await this.redis.set(
      key,
      JSON.stringify(record),
      'EX',
      editLockTtlSeconds,
      'NX',
    );
    if (acquired !== 'OK') {
      const holder = this.parseLock(await this.redis.get(key));
      throw new ConflictException(holder
        ? `Form is being edited by ${holder.holderName}`
        : 'Form edit lock is temporarily unavailable');
    }
    return {
      expiresIn: editLockTtlSeconds,
      lock: this.toLockSummary(record),
      token,
    };
  }

  /** 仅匹配 token 与持有者的会话可以延长锁。 */
  public async heartbeatEditLock(
    workspaceId: number,
    formId: string,
    token: string,
    actor: AuthenticatedActor,
  ): Promise<HeartbeatFormEditLockResult> {
    const form = await this.findForm(workspaceId, formId);
    await this.findManagedDataset(workspaceId, form.datasetId, actor);
    if (form.status === FormStatus.archived) throw new ConflictException('Form is archived');
    const extended = await this.redis.eval(
      `local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local lock = cjson.decode(value)
if lock.token ~= ARGV[1] or lock.userId ~= ARGV[2] then return 0 end
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1`,
      1,
      this.editLockKey(workspaceId, formId),
      token,
      actor.userId,
      String(editLockTtlSeconds),
    );
    if (Number(extended) !== 1) {
      throw new ConflictException('Form edit lock is missing, expired, or owned by another session');
    }
    return { expiresIn: editLockTtlSeconds };
  }

  /** 仅匹配 token 与持有者的会话可以原子释放锁。 */
  public async releaseEditLock(
    workspaceId: number,
    formId: string,
    token: string,
    actor: AuthenticatedActor,
  ): Promise<ReleaseFormEditLockResult> {
    const form = await this.findForm(workspaceId, formId);
    await this.findManagedDataset(workspaceId, form.datasetId, actor);
    const released = await this.redis.eval(
      `local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local lock = cjson.decode(value)
if lock.token ~= ARGV[1] or lock.userId ~= ARGV[2] then return 0 end
return redis.call('DEL', KEYS[1])`,
      1,
      this.editLockKey(workspaceId, formId),
      token,
      actor.userId,
    );
    if (Number(released) !== 1) {
      throw new ConflictException('Form edit lock is missing, expired, or owned by another session');
    }
    return { released: true };
  }

  /** 按全局 Form ID 获取公开填写所需的最小已发布定义。 */
  public async getPublished(formId: string): Promise<PublishedFormDefinition> {
    const form = await this.findPublishedForm(formId);
    const version = form.activeVersion;
    const fields = await this.prisma.datasetField.findMany({
      where: { datasetId: form.datasetId },
    });
    let runtimeSchema = version.schema as PublishedFormDefinition['schema'];
    let choiceOptions: PublishedFormDefinition['choiceOptions'] = {};
    let configurationInvalid = false;
    try {
      const parsed = parseFormSchema(runtimeSchema, { mode: 'legacy' });
      const projected = projectCurrentFormFields(parsed, fields as never, {
        locale: version.defaultLocale,
      });
      runtimeSchema = projected.schema;
      choiceOptions = projected.choiceOptions as PublishedFormDefinition['choiceOptions'];
      configurationInvalid = projected.configurationInvalidItemIds.length > 0;
    } catch {
      configurationInvalid = true;
    }
    const availability = configurationInvalid
      ? { acceptingSubmissions: false as const, unavailableReason: 'configuration_invalid' as const }
      : this.publishedAvailability(form);
    return {
      id: form.id,
      version: version.version,
      defaultLocale: version.defaultLocale,
      nameI18n: version.nameI18n as Record<string, string>,
      descriptionI18n: version.descriptionI18n as Record<string, string> | null,
      closingMessageI18n: version.closingMessageI18n as Record<string, string> | null,
      opensAt: version.opensAt?.toISOString() ?? null,
      closesAt: version.closesAt?.toISOString() ?? null,
      submissionAccess: version.submissionAccess,
      writeMode: version.writeMode,
      schema: runtimeSchema,
      choiceOptions,
      ...availability,
      submissionContext: null,
    };
  }

  /**
   * 为已发布 Form 的关联选择器提供动态选项。
   * 根据 Schema 中配置的 filter 表达式筛选目标 Dataset 行，
   * 并仅返回 row ID 和 label 字段值。
   */
  public async relationOptions(
    formId: string,
    itemId: string,
    rawValues: string | undefined,
    take: number,
  ): Promise<FormRelationOption[]> {
    if (!Number.isInteger(take) || take < 1 || take > 100) {
      throw new BadRequestException('Relation option take must be between 1 and 100');
    }
    const form = await this.findPublishedForm(formId);
    const parsed = parseFormSchema(form.activeVersion.schema as PublishedFormDefinition['schema'], {
      mode: 'legacy',
    });
    const item = parsed.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new NotFoundException('Form item not found');
    const options = item.extension.ui?.options;
    const sourceFields = await this.prisma.datasetField.findMany({
      where: { datasetId: form.datasetId },
    });
    const field = sourceFields.find((candidate) => (
      candidate.id === item.extension.datasetFieldId
    ));
    if (!field
      || field.datasetId !== form.datasetId
      || field.archivedAt
      || field.kind !== DatasetFieldKind.relation
      || !field.relationTargetDatasetId
      || typeof options?.labelFieldId !== 'string') {
      throw new BadRequestException('Form item is not a relation selector');
    }
    const suppliedValues = this.parseCurrentValues(rawValues);
    const projected = projectCurrentFormFields(parsed, sourceFields as never, {
      locale: form.activeVersion.defaultLocale,
    });
    const evaluated = evaluateFormAnswers({
      parsed,
      runtimeSchema: projected.schema,
      inputAnswers: suppliedValues,
      rejectExplicitHidden: false,
    });
    if (evaluated.unknownItemIds.length > 0) {
      throw new BadRequestException('Relation option values contain unknown Form items');
    }
    // 查询目标 Dataset 的活跃行（上限 500，内存过滤后再截断至 take）。
    const rows = await this.prisma.datasetRow.findMany({
      where: { datasetId: field.relationTargetDatasetId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const { filter } = options;
    const { labelFieldId } = options;
    return rows
      .filter((row) => evaluateRelationFilter(
        filter,
        row.values as Record<string, JsonValue>,
        evaluated.answers,
      ))
      .slice(0, take)
      .map((row) => {
        const label = (row.values as Record<string, JsonValue>)[labelFieldId];
        return { id: row.id, label: label === undefined || label === null ? '' : String(label) };
      });
  }

  private toPanelSummary(
    form: PanelFormRecord,
    lock: FormEditLockSummary,
  ): FormPanelSummary {
    const definition = form.versions[0] ?? form.activeVersion;
    return {
      ...this.toFormSummary(form),
      title: definition
        ? resolveLocalizedText(
          definition.nameI18n as Record<string, string>,
          definition.defaultLocale,
          definition.defaultLocale,
        ) || form.slug
        : form.slug,
      creator: this.toCreatorSummary(form.createdBy),
      hasDraft: form.versions.length > 0,
      hasRelease: form.activeVersion !== null,
      lock,
    };
  }

  private toFormSummary(form: Pick<
  Form,
  | 'activeVersionId'
  | 'createdAt'
  | 'datasetId'
  | 'id'
  | 'revision'
  | 'slug'
  | 'status'
  | 'updatedAt'
  | 'workspaceId'
  >): FormSummary {
    return {
      id: form.id,
      workspaceId: form.workspaceId,
      datasetId: form.datasetId,
      slug: form.slug,
      status: form.status,
      activeVersionId: form.activeVersionId,
      revision: form.revision,
      createdAt: form.createdAt.toISOString(),
      updatedAt: form.updatedAt.toISOString(),
    };
  }

  private toVersionDefinition(
    version: FormVersion,
  ): FormVersionDefinition {
    return {
      id: version.id,
      formId: version.formId,
      version: version.version,
      state: version.state,
      defaultLocale: version.defaultLocale,
      nameI18n: version.nameI18n as Record<string, string>,
      descriptionI18n: version.descriptionI18n as Record<string, string> | null,
      closingMessageI18n: version.closingMessageI18n as Record<string, string> | null,
      opensAt: version.opensAt?.toISOString() ?? null,
      closesAt: version.closesAt?.toISOString() ?? null,
      submissionAccess: version.submissionAccess,
      writeMode: version.writeMode,
      schema: version.schema as FormVersionDefinition['schema'],
      schemaChecksum: version.schemaChecksum,
      revision: version.revision,
    };
  }

  private toCreatorSummary(user: {
    id: string;
    name: string;
    nickname: string;
    username: string;
  }): FormCreatorSummary {
    return {
      id: user.id,
      displayName: user.nickname || user.name || user.username,
    };
  }

  private editLockKey(workspaceId: number, formId: string): string {
    return `form:edit-lock:${workspaceId}:${formId}`;
  }

  private parseLock(value: string | null): FormEditLockRecord | null {
    if (!value) return null;
    try {
      const record = JSON.parse(value) as Partial<FormEditLockRecord>;
      if (typeof record.userId !== 'string'
        || typeof record.holderName !== 'string'
        || typeof record.lockedAt !== 'string'
        || typeof record.token !== 'string') return null;
      return record as FormEditLockRecord;
    } catch {
      return null;
    }
  }

  private toLockSummary(lock: FormEditLockRecord | null): FormEditLockSummary {
    return lock
      ? {
        locked: true,
        holderUserId: lock.userId,
        holderName: lock.holderName,
        lockedAt: lock.lockedAt,
      }
      : {
        locked: false,
        holderUserId: null,
        holderName: null,
        lockedAt: null,
      };
  }

  private async assertEditLock(
    workspaceId: number,
    formId: string,
    token: string,
    userId: string,
  ): Promise<void> {
    const lock = this.parseLock(await this.redis.get(this.editLockKey(workspaceId, formId)));
    if (!lock) throw new ConflictException('Form edit lock is missing or expired');
    if (lock.token !== token || lock.userId !== userId) {
      throw new ConflictException('Form edit lock belongs to another session');
    }
  }

  /**
   * 执行完整的 Form 定义校验。
   * 收集当前 Dataset 字段、关系目标字段和目标 Dataset 后委托给 FormDefinitionValidator。
   */
  private async validateDefinition(
    tx: Prisma.TransactionClient,
    dataset: Pick<Dataset, 'id' | 'subjectMode' | 'type'>,
    schema: Record<string, unknown>,
    definition: Pick<VersionDefinitionInput, 'submissionAccess' | 'writeMode'>,
  ): Promise<void> {
    const sourceFields = await tx.datasetField.findMany({ where: { datasetId: dataset.id } });
    const targetIds = sourceFields.flatMap((field) => (
      field.relationTargetDatasetId ? [field.relationTargetDatasetId] : []
    ));
    const [targetFields, targetDatasets] = await Promise.all([
      targetIds.length === 0 ? [] : tx.datasetField.findMany({
        where: { datasetId: { in: targetIds } },
      }),
      targetIds.length === 0 ? [] : tx.dataset.findMany({
        where: { id: { in: targetIds } },
        select: { id: true, type: true },
      }),
    ]);
    this.validator.validate(schema, {
      dataset,
      fields: [...sourceFields, ...targetFields],
      targetDatasets,
      submissionAccess: definition.submissionAccess,
      writeMode: definition.writeMode,
    });
  }

  /**
   * 确保设备信息采集所需的系统字段存在。
   * 若 capture 中指定了 browser/operatingSystem/userAgent 采集，
   * 按 systemKey 查找并复用已有字段；不存在则自动创建 isSystemManaged=true 的 text 字段。
   * 新创建字段时会创建 DatasetVersion 快照。
   */
  private async ensureCaptureFields(
    tx: Prisma.TransactionClient,
    datasetId: string,
    schema: Record<string, unknown>,
    actorUserId: string,
  ): Promise<void> {
    const root = schema['x-form'] as Record<string, unknown> | undefined;
    const capture = root?.capture as Record<string, { datasetFieldId: string }> | undefined;
    if (!capture || Object.keys(capture).length === 0) return;
    let created = false;
    const position = await tx.datasetField.count({ where: { datasetId, archivedAt: null } });
    await Promise.all(Object.entries(capture).map(async ([captureKey, setting], index) => {
      const definition = captureDefinitions[captureKey as keyof typeof captureDefinitions];
      if (!definition) throw new BadRequestException(`Unknown capture setting: ${captureKey}`);
      // 若已显式选择了一个匹配的系统字段，跳过创建。
      const selected = setting.datasetFieldId && setting.datasetFieldId !== 'managed'
        ? await tx.datasetField.findUnique({ where: { id: setting.datasetFieldId } })
        : null;
      if (selected && selected.datasetId === datasetId
        && selected.isSystemManaged && selected.systemKey === definition.key) return;
      // 按 systemKey 查找已有字段。
      let field = await tx.datasetField.findFirst({
        where: { datasetId, systemKey: definition.key },
      });
      if (!field) {
        field = await tx.datasetField.upsert({
          where: { datasetId_systemKey: { datasetId, systemKey: definition.key } },
          update: {},
          create: {
            workspaceId: 1,
            datasetId,
            key: definition.key,
            name: definition.name,
            kind: DatasetFieldKind.text,
            valueSchema: { type: 'string', maxLength: 2_000 },
            isSystemManaged: true,
            systemKey: definition.key,
            position: position + index,
          },
        });
        created = true;
      }
      // 将 Schema 中的 datasetFieldId 替换为实际字段 ID。
      capture[captureKey] = { datasetFieldId: field.id };
    }));
    if (created) {
      await tx.dataset.update({ where: { id: datasetId }, data: { revision: { increment: 1 } } });
      await this.datasets.createDefinitionVersion(
        tx,
        datasetId,
        actorUserId,
        'form.capture.enable',
      );
    }
  }

  /** 将版本定义转换为 FormVersion 的 Prisma 写入数据。 */
  private versionData(
    dto: VersionDefinitionInput,
    schema: Record<string, unknown>,
    schemaChecksum: string,
  ) {
    return {
      defaultLocale: dto.defaultLocale,
      nameI18n: dto.nameI18n,
      descriptionI18n: dto.descriptionI18n,
      closingMessageI18n: dto.closingMessageI18n,
      opensAt: dto.opensAt ? new Date(dto.opensAt) : undefined,
      closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
      submissionAccess: dto.submissionAccess,
      writeMode: dto.writeMode,
      schema: schema as Prisma.InputJsonObject,
      schemaChecksum,
    };
  }

  /**
   * 校验 Form 元数据：
   * - 所有 i18n map 必须包含 defaultLocale 对应的条目
   * - opensAt 必须早于 closesAt
   */
  private validateMetadata(definition: {
    closesAt?: string;
    closingMessageI18n?: Record<string, string>;
    defaultLocale: string;
    descriptionI18n?: Record<string, string>;
    nameI18n: Record<string, string>;
    opensAt?: string;
  }): void {
    [definition.nameI18n, definition.descriptionI18n, definition.closingMessageI18n]
      .filter((map): map is Record<string, string> => Boolean(map))
      .forEach((map) => {
        if (typeof map[definition.defaultLocale] !== 'string') {
          throw new BadRequestException(`Locale map requires ${definition.defaultLocale}`);
        }
      });
    if (definition.opensAt && definition.closesAt
      && new Date(definition.opensAt) >= new Date(definition.closesAt)) {
      throw new BadRequestException('Form opensAt must be before closesAt');
    }
  }

  private async findCurrentFormDataset(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    datasetId: string,
    formId: string,
    expectedFormStatus: FormStatus | undefined,
    errorMessage: string,
  ) {
    const [currentDataset, currentForm] = await Promise.all([
      tx.dataset.findUnique({ where: { id: datasetId } }),
      tx.form.findUnique({ where: { id: formId } }),
    ]);
    if (!currentDataset
      || currentDataset.workspaceId !== workspaceId
      || currentDataset.status !== DatasetStatus.active
      || !currentForm
      || currentForm.workspaceId !== workspaceId
      || currentForm.datasetId !== currentDataset.id
      || currentForm.status === FormStatus.archived
      || (expectedFormStatus !== undefined && currentForm.status !== expectedFormStatus)) {
      throw new ConflictException(errorMessage);
    }
    return { currentDataset, currentForm };
  }

  /** 按 ID 查找 Form，验证其属于指定 Workspace。 */
  private async findForm(workspaceId: number, formId: string) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form || form.workspaceId !== workspaceId) throw new NotFoundException('Form not found');
    return form;
  }

  /**
   * 查找 Form 所绑定的 Dataset，并验证操作者有管理权限。
   * 持有 form.manage_all 权限的用户绕过协作者校验。
   */
  private async findManagedDataset(
    workspaceId: number,
    datasetId: string,
    actor: AuthenticatedActor,
  ) {
    if (!actor.permissions.includes('form.manage_all')) {
      return this.datasets.assertCanManage(workspaceId, datasetId, actor);
    }
    if (actor.workspaceId !== workspaceId) throw new NotFoundException('Workspace not found');
    const dataset = await this.prisma.dataset.findUnique({
      where: { workspaceId_id: { workspaceId, id: datasetId } },
    });
    if (!dataset) throw new NotFoundException('Dataset not found');
    return dataset;
  }

  /** 将 URL 参数中的 JSON 字符串解析为当前表单值对象，供关联筛选使用。 */
  private parseCurrentValues(raw: string | undefined): Record<string, JsonValue> {
    if (!raw) return {};
    try {
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value as Record<string, JsonValue>;
    } catch {
      throw new BadRequestException('Relation option values must be a JSON object');
    }
  }

  /**
   * 在事务中准备 Form Schema：深拷贝、处理设备信息采集字段、校验定义、计算校验和。
   */
  private async prepareFormSchema(
    tx: Prisma.TransactionClient,
    dataset: Pick<Dataset, 'id' | 'subjectMode' | 'type'>,
    dto: Pick<VersionDefinitionInput, 'schema' | 'defaultLocale' | 'nameI18n' | 'submissionAccess' | 'writeMode'>,
    userId: string,
  ): Promise<{ schema: Record<string, unknown>; checksum: string }> {
    let schema: Record<string, unknown>;
    try {
      schema = normalizeFormSchemaPositions(dto.schema as JsonSchema) as Record<string, unknown>;
    } catch (error) {
      throw new BadRequestException(
        `Invalid Form Schema: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await this.ensureCaptureFields(tx, dataset.id, schema, userId);
    await this.validateDefinition(tx, dataset, schema, dto);
    const checksum = await checksumJson(schema as JsonValue);
    return { schema, checksum };
  }

  private hasCaptureConfiguration(schema: Record<string, unknown>): boolean {
    const root = schema['x-form'];
    if (!root || typeof root !== 'object' || Array.isArray(root)) return false;
    const { capture } = (root as Record<string, unknown>);
    return Boolean(capture
      && typeof capture === 'object'
      && !Array.isArray(capture)
      && Object.keys(capture).length > 0);
  }

  /**
   * 查找已发布的 Form（含 activeVersion），未找到或状态异常时抛出 NotFoundException。
   * 返回类型已确保 activeVersion 非 null。
   */
  private async findPublishedForm(formId: string) {
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      include: { activeVersion: true, dataset: true },
    });
    if (!form
      || form.status === FormStatus.archived
      || !form.activeVersion
      || form.activeVersion.state !== FormVersionState.published) {
      throw new NotFoundException('Published Form not found');
    }
    // 经过上述校验后 activeVersion 必然非 null，显式断言使调用方无需重复检查。
    return form as typeof form & { activeVersion: NonNullable<typeof form.activeVersion> };
  }

  /** Derive a stable public availability state without exposing management details. */
  private publishedAvailability(form: Awaited<ReturnType<FormsService['findPublishedForm']>>): Pick<
  PublishedFormDefinition,
  'acceptingSubmissions' | 'unavailableReason'
  > {
    if (form.status === FormStatus.closed) {
      return { acceptingSubmissions: false, unavailableReason: 'closed' };
    }
    if (form.dataset.status !== DatasetStatus.active) {
      return { acceptingSubmissions: false, unavailableReason: 'inactive' };
    }
    const now = new Date();
    if (form.activeVersion.opensAt && now < form.activeVersion.opensAt) {
      return { acceptingSubmissions: false, unavailableReason: 'not_started' };
    }
    if (form.activeVersion.closesAt && now > form.activeVersion.closesAt) {
      return { acceptingSubmissions: false, unavailableReason: 'closed' };
    }
    return { acceptingSubmissions: true, unavailableReason: null };
  }
}
