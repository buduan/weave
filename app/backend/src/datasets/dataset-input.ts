import {
  DatasetCollaboratorRole,
  DatasetFieldKind,
  DatasetSubjectMode,
  DatasetType,
  RelationCardinality,
} from '@prisma/client';

// ---- Dataset CRUD ----

/** 创建 Dataset（逻辑数据表）的入参。 */
export interface CreateDatasetInput {
  name: string;
  slug: string;
  description?: string;
  type: DatasetType;
  /** 控制每个用户是否只能拥有一行数据。 */
  subjectMode: DatasetSubjectMode;
}

/** 更新 Dataset 元数据的入参，携带乐观锁版本号。 */
export interface UpdateDatasetInput {
  /** 调用方必须传入上次读取到的 revision，版本不匹配时更新被拒绝。 */
  expectedRevision: number;
  name?: string;
  slug?: string;
  description?: string;
}

// ---- 协作者 ----

/** 授予或变更 Dataset 协作者角色的入参。 */
export interface AddDatasetCollaboratorInput {
  workspaceMemberId: string;
  role: DatasetCollaboratorRole;
}

// ---- 字段 ----

/** 创建 Dataset 字段（逻辑列）的入参。 */
export interface CreateDatasetFieldInput {
  expectedDatasetRevision: number;
  key: string;
  name: string;
  description?: string;
  kind: DatasetFieldKind;
  /** 字段单个值的 Draft 2020-12 JSON Schema。省略时由 kind 推导。 */
  valueSchema?: unknown;
  /** UI 配置（组件类型、选项等），以不透明 JSON 存储。 */
  config: Record<string, unknown>;
  required: boolean;
  relationTargetDatasetId?: string;
  relationCardinality?: RelationCardinality;
  /** 不传时自动追加到末尾。 */
  position?: number;
}

/** 更新 Dataset 字段的入参，携带乐观锁版本号。 */
export interface UpdateDatasetFieldInput {
  /** 调用方必须同时传入 Dataset 和字段上次读取到的 revision。 */
  expectedDatasetRevision: number;
  expectedFieldRevision: number;
  name?: string;
  description?: string;
  kind?: DatasetFieldKind;
  valueSchema?: unknown;
  config?: Record<string, unknown>;
  required?: boolean;
  position?: number;
}

export interface ArchiveDatasetFieldInput {
  expectedDatasetRevision: number;
  expectedFieldRevision: number;
}

// ---- 数据行 ----

/**
 * 创建或更新 Dataset 行的入参。
 * values   → 以 fieldId 为 key 的普通标量字段。
 * relations → 以 fieldId 为 key 的关联字段值；
 *             一对一传单个 target rowId 字符串，一对多传 rowId 数组。
 */
export interface DatasetRowValuesInput {
  values: Record<string, unknown>;
  relations: Record<string, unknown>;
}

/** 更新 Dataset 行的入参，继承 values/relations 并携带乐观锁版本号。 */
export interface UpdateDatasetRowInput extends DatasetRowValuesInput {
  /** 调用方必须传入行上次读取到的 revision。 */
  expectedRevision: number;
}
