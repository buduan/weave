import type { JsonSchema, JsonSchemaObject, JsonValue } from './json';
import type { DatasetChoiceOption } from './datasets';

/** 多语言文案映射，key 为 BCP 47 locale。 */
export type LocalizedText = Record<string, string>;

/** Form item 的稳定不透明 ID，格式为 q_ + UUID v4。 */
export type FormItemId = string;

// ---- 枚举常量与类型 ----

/** Form 状态：活跃、已关闭、已归档。 */
export const formStatuses = ['active', 'closed', 'archived'] as const;
export type FormStatus = (typeof formStatuses)[number];

/** Form 版本状态：草稿、已发布（不可变）、已退役。 */
export const formVersionStates = ['draft', 'published', 'retired'] as const;
export type FormVersionState = (typeof formVersionStates)[number];

/** 提交权限：允许匿名 或 必须登录。 */
export const formSubmissionAccesses = ['anonymous_allowed', 'authentication_required'] as const;
export type FormSubmissionAccess = (typeof formSubmissionAccesses)[number];

/** Form 写入模式：新增行 或 更新当前用户关联行。 */
export const formWriteModes = ['create_row', 'update_subject_row'] as const;
export type FormWriteMode = (typeof formWriteModes)[number];

/** 提交操作结果：已创建 或 已更新。 */
export const formSubmissionOperations = ['created', 'updated'] as const;
export type FormSubmissionOperation = (typeof formSubmissionOperations)[number];

/** Form renderer 支持的规范化 widget 名称。 */
export const formWidgets = [
  'input',
  'textarea',
  'checkbox',
  'radio',
  'selector',
  'cascader',
  'tags-input',
] as const;
export type FormWidget = (typeof formWidgets)[number];

// ---- availableIf 条件表达式 ----

/** availableIf 叶子操作符集合。 */
export const availableIfLeafOperators = [
  'equals',
  'not_equals',
  'in',
  'not_in',
  'contains',
  'is_empty',
  'is_not_empty',
] as const;
export type AvailableIfLeafOperator = (typeof availableIfLeafOperators)[number];

/** 比较型条件：fieldId 的值与固定 value 比较。 */
export interface AvailableIfComparisonExpression {
  fieldId: FormItemId;
  operator: 'contains' | 'equals' | 'not_equals';
  value: JsonValue;
}

/** 集合型条件：fieldId 的值是否在/不在 values 列表中。 */
export interface AvailableIfMembershipExpression {
  fieldId: FormItemId;
  operator: 'in' | 'not_in';
  values: JsonValue[];
}

/** 空值判断条件：fieldId 的值是否为空。 */
export interface AvailableIfEmptyExpression {
  fieldId: FormItemId;
  operator: 'is_empty' | 'is_not_empty';
}

/** 组合条件组：and（全满足）或 or（任一满足）。 */
export interface AvailableIfGroupExpression {
  operator: 'and' | 'or';
  conditions: AvailableIfExpression[];
}

/** 逻辑取反：对嵌套表达式结果取反。 */
export interface AvailableIfNotExpression {
  operator: 'not';
  condition: AvailableIfExpression;
}

/** availableIf 表达式的联合类型。 */
export type AvailableIfExpression =
  | AvailableIfComparisonExpression
  | AvailableIfEmptyExpression
  | AvailableIfGroupExpression
  | AvailableIfMembershipExpression
  | AvailableIfNotExpression;

// ---- 关联筛选 ----

/** 关联选项筛选操作符。 */
export const relationFilterOperators = [
  'equals',
  'not_equals',
  'in',
  'contains',
  'is_empty',
  'is_not_empty',
] as const;
export type RelationFilterOperator = (typeof relationFilterOperators)[number];

/** 单个筛选条件。valueFrom 引用当前 Form 的另一个 item 值，实现级联筛选。 */
export interface RelationFilterCondition {
  fieldId: string;
  operator: RelationFilterOperator;
  value?: JsonValue;
  valueFrom?: FormItemId;
}

/** 筛选表达式：all（全部满足）或 any（任一满足）。 */
export interface RelationFilterExpression {
  all?: RelationFilterCondition[];
  any?: RelationFilterCondition[];
}

// ---- Form Schema x-form 扩展 ----

/** Form item 的多语言扩展。 */
export interface FormItemI18n {
  description?: LocalizedText;
  placeholder?: LocalizedText;
  title?: LocalizedText;
}

/** Form item 的 UI 选项（关联筛选、标签字段等）。 */
export interface FormItemUiOptions {
  filter?: RelationFilterExpression;
  labelFieldId?: string;
}

/** Form item 的 UI 配置。 */
export interface FormItemUi {
  options?: FormItemUiOptions;
  widget?: FormWidget;
}

/** Form item 的 x-form 扩展（字段映射、i18n、UI、条件显示）。 */
export interface FormItemExtension {
  datasetFieldId: string;
  /** 稳定展示顺序；新写入的 Schema 必须从 0 开始连续编号。 */
  position: number;
  i18n?: FormItemI18n;
  ui?: FormItemUi;
  availableIf?: AvailableIfExpression;
}

/** 单个设备采集字段配置。 */
export interface FormCaptureField {
  datasetFieldId: string;
}

/** 设备信息采集设置。 */
export interface FormCaptureSettings {
  browser?: FormCaptureField;
  operatingSystem?: FormCaptureField;
  userAgent?: FormCaptureField;
}

/** Form 根节点的 x-form 扩展。 */
export interface FormRootExtension {
  capture: FormCaptureSettings;
  datasetId: string;
  i18n?: FormItemI18n;
  version: 1;
}

// ---- 读模型接口 ----

/** Form 摘要。 */
export interface FormSummary {
  id: string;
  workspaceId: number;
  datasetId: string;
  slug: string;
  status: FormStatus;
  activeVersionId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Form 版本定义（读模型）。 */
export interface FormVersionDefinition {
  id: string;
  formId: string;
  version: number;
  state: FormVersionState;
  defaultLocale: string;
  nameI18n: LocalizedText;
  descriptionI18n: LocalizedText | null;
  closingMessageI18n: LocalizedText | null;
  opensAt: string | null;
  closesAt: string | null;
  submissionAccess: FormSubmissionAccess;
  writeMode: FormWriteMode;
  /** 完整的 Form JSON Schema（AJV Draft 2020-12 方言校验 + x-form 扩展；不要求 $schema）。 */
  schema: JsonSchema;
  /** Schema 内容的 SHA-256 规范校验和，用于幂等比较。 */
  schemaChecksum: string;
  revision: number;
}

/** 提交记录摘要。 */
export interface FormSubmissionSummary {
  id: string;
  formId: string;
  formVersionId: string;
  datasetId: string;
  rowId: string;
  rowVersionId: string;
  /** 匿名提交时为空。 */
  submitterUserId: string | null;
  operation: FormSubmissionOperation;
  submittedAt: string;
}

// ---- Public Form filling API ----

/** Stable reasons why a published Form cannot currently accept submissions. */
export const formAvailabilityReasons = [
  'not_started',
  'closed',
  'inactive',
  'configuration_invalid',
  'subject_row_missing',
] as const;
export type FormAvailabilityReason = (typeof formAvailabilityReasons)[number];

/** Actor-bound values used to update an existing subject row. */
export interface FormSubmissionContext {
  answers: Record<FormItemId, JsonValue>;
  expectedRevision: number;
}

/** Minimal published Form definition safe for public filling. */
export interface PublishedFormDefinition {
  id: string;
  version: number;
  defaultLocale: string;
  nameI18n: LocalizedText;
  descriptionI18n: LocalizedText | null;
  closingMessageI18n: LocalizedText | null;
  opensAt: string | null;
  closesAt: string | null;
  submissionAccess: FormSubmissionAccess;
  writeMode: FormWriteMode;
  schema: JsonSchema;
  choiceOptions: Record<FormItemId, DatasetChoiceOption[]>;
  acceptingSubmissions: boolean;
  unavailableReason: FormAvailabilityReason | null;
  submissionContext: FormSubmissionContext | null;
}

/** Public relation option; Dataset contents remain opaque. */
export interface FormRelationOption {
  id: string;
  label: string;
}

/** Public submission request keyed by published Form item IDs. */
export interface SubmitFormRequest {
  formId: string;
  answers: Record<FormItemId, JsonValue>;
  expectedRevision?: number;
}

/** Minimal result returned by the public submission endpoint. */
export interface SubmitFormResult {
  submissionId: string;
  operation: FormSubmissionOperation;
  submittedAt: string;
}

// ---- Panel Form 管理 API ----

/** 表单列表分区。main = active + closed。 */
export const formListSections = ['main', 'archived', 'all'] as const;
export type FormListSection = (typeof formListSections)[number];

/** 面板中展示的 Form 创建人。 */
export interface FormCreatorSummary {
  id: string;
  displayName: string;
}

/** Redis 编辑锁的安全摘要；不向非持有者暴露 token。 */
export interface FormEditLockSummary {
  locked: boolean;
  holderUserId: string | null;
  holderName: string | null;
  lockedAt: string | null;
}

/** Form 面板列表项。 */
export interface FormPanelSummary extends FormSummary {
  title: string;
  creator: FormCreatorSummary;
  hasDraft: boolean;
  hasRelease: boolean;
  lock: FormEditLockSummary;
}

/** Form 面板详情，draft/release 均由现有版本状态推导。 */
export interface FormPanelDetail extends FormSummary {
  creator: FormCreatorSummary;
  draft: FormVersionDefinition | null;
  release: FormVersionDefinition | null;
  lock: FormEditLockSummary;
}

/** 创建或保存 draft 时提交的完整版本定义。 */
export interface FormDraftDefinitionInput {
  defaultLocale: string;
  nameI18n: LocalizedText;
  descriptionI18n?: LocalizedText;
  closingMessageI18n?: LocalizedText;
  opensAt?: string;
  closesAt?: string;
  submissionAccess: FormSubmissionAccess;
  writeMode: FormWriteMode;
  schema: JsonSchemaObject;
}

export interface CreateFormRequest extends FormDraftDefinitionInput {
  datasetId: string;
  slug: string;
}

export interface CreateFormResult {
  form: FormSummary;
  draft: FormVersionDefinition;
}

export interface SaveFormDraftRequest extends FormDraftDefinitionInput {
  formId: string;
  expectedRevision: number;
  lockToken: string;
}

export interface PublishFormRequest {
  formId: string;
  expectedRevision: number;
  lockToken: string;
}

export interface ChangeFormStatusRequest {
  formId: string;
  expectedRevision: number;
}

export interface FormEditLockRequest {
  formId: string;
}

export interface FormEditLockTokenRequest extends FormEditLockRequest {
  token: string;
}

export interface AcquireFormEditLockResult {
  expiresIn: number;
  lock: FormEditLockSummary;
  token: string;
}

export interface HeartbeatFormEditLockResult {
  expiresIn: number;
}

export interface ReleaseFormEditLockResult {
  released: true;
}
