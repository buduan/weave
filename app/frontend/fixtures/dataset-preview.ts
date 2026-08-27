import type {
  DatasetFieldDefinition,
  DatasetFieldKind,
  DatasetOption,
  DatasetSummary,
  DatasetTableQuery,
  DatasetWindowQueryRequest,
  DatasetWindowQueryResponse,
  JsonObject,
  JsonValue,
  RelationCardinality,
} from '@weave/types';
import {
  applyDatasetQuery,
  canonicalizeDatasetQuery,
  createDatasetGroupDirectory,
  getDatasetQueryFingerprint,
} from '~/components/dataset/dataset-query';
import { dataTypeOfKind, valueSchemaForField } from '@weave/utils';
import type { DatasetTableRow } from '~/components/dataset/types';

export const DATASET_PREVIEW_ROW_COUNT = 5_000;
export const DATASET_PREVIEW_FIELD_COUNT = 100;

const DATASET_ID = 'dataset-preview';
const NOW = '2026-08-03T08:00:00.000Z';

const selectOptions: DatasetOption[] = [
  { label: '待处理', value: 'pending' },
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'done' },
];

const skillOptions: DatasetOption[] = [
  { label: '产品', value: 'product' },
  { label: '设计', value: 'design' },
  { label: '前端', value: 'frontend' },
  { label: '后端', value: 'backend' },
];

const levelOptions: DatasetOption[] = [
  { label: '初级', value: 'junior' },
  { label: '中级', value: 'mid' },
  { label: '高级', value: 'senior' },
];

interface FieldFixture {
  key: string;
  name: string;
  kind: DatasetFieldKind;
  required?: boolean;
  options?: DatasetOption[];
  relationCardinality?: RelationCardinality;
  systemManaged?: boolean;
  width?: number;
}

function createValueSchema(kind: DatasetFieldKind): JsonObject {
  return valueSchemaForField(kind) as JsonObject;
}

const baseFieldFixtures: FieldFixture[] = [
  {
    key: 'name', name: '姓名', kind: 'text', required: true,
  },
  {
    key: 'bio', name: '个人简介', kind: 'long_text', width: 260,
  },
  { key: 'age', name: '年龄', kind: 'number' },
  { key: 'enabled', name: '启用', kind: 'checkbox' },
  { key: 'joined_date', name: '加入日期', kind: 'date' },
  { key: 'reminder_time', name: '提醒时间', kind: 'time' },
  {
    key: 'last_seen_at', name: '最近在线', kind: 'datetime', width: 220,
  },
  {
    key: 'email', name: '邮箱', kind: 'email', width: 220,
  },
  {
    key: 'homepage', name: '主页', kind: 'url', width: 240,
  },
  {
    key: 'status', name: '状态', kind: 'single_select', options: selectOptions,
  },
  {
    key: 'skills', name: '技能', kind: 'multi_select', options: skillOptions, width: 220,
  },
  {
    key: 'metadata', name: '元数据', kind: 'json', width: 260,
  },
  {
    key: 'mentor', name: '导师', kind: 'relation', relationCardinality: 'one',
  },
  {
    key: 'team_members', name: '协作成员', kind: 'relation', relationCardinality: 'many', width: 220,
  },
  { key: 'city', name: '城市', kind: 'text' },
  {
    key: 'notes', name: '备注', kind: 'long_text', width: 260,
  },
  { key: 'score', name: '评分', kind: 'number' },
  { key: 'subscribed', name: '订阅通知', kind: 'checkbox' },
  { key: 'birthday', name: '生日', kind: 'date' },
  { key: 'office_time', name: '办公时间', kind: 'time' },
  {
    key: 'modified_at', name: '更新时间', kind: 'datetime', systemManaged: true, width: 220,
  },
  {
    key: 'alternate_email', name: '备用邮箱', kind: 'email', width: 220,
  },
  {
    key: 'document_url', name: '资料地址', kind: 'url', width: 240,
  },
  {
    key: 'level', name: '级别', kind: 'single_select', options: levelOptions,
  },
  {
    key: 'tags', name: '标签', kind: 'multi_select', options: skillOptions, width: 220,
  },
  {
    key: 'preferences', name: '偏好配置', kind: 'json', width: 260,
  },
  {
    key: 'owner', name: '负责人', kind: 'relation', relationCardinality: 'one',
  },
  {
    key: 'reviewers', name: '审核人', kind: 'relation', relationCardinality: 'many', width: 220,
  },
  { key: 'project', name: '项目', kind: 'text' },
  { key: 'budget', name: '预算', kind: 'number' },
];

const supplementalKinds: DatasetFieldKind[] = [
  'text',
  'number',
  'checkbox',
  'date',
  'single_select',
];

const fieldFixtures: FieldFixture[] = [
  ...baseFieldFixtures,
  ...Array.from(
    { length: DATASET_PREVIEW_FIELD_COUNT - baseFieldFixtures.length },
    (_, index): FieldFixture => {
      const position = baseFieldFixtures.length + index + 1;
      const kind = supplementalKinds[index % supplementalKinds.length] ?? 'text';
      return {
        key: `extended_${position}`,
        name: `扩展字段 ${position}`,
        kind,
        ...(kind === 'single_select' ? { options: selectOptions } : {}),
      };
    },
  ),
];

export const datasetPreviewDataset: DatasetSummary = {
  id: DATASET_ID,
  workspaceId: 1,
  name: '成员数据集预览',
  slug: 'dataset-preview',
  description: 'Phase 1B 绝对窗口本地模拟数据',
  type: 'members',
  status: 'active',
  subjectMode: 'single_per_user',
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

export const datasetPreviewFields: DatasetFieldDefinition[] = fieldFixtures
  .map((fixture, index) => ({
    id: `field-${fixture.key}`,
    datasetId: DATASET_ID,
    key: fixture.key,
    name: fixture.name,
    description: null,
    dataType: dataTypeOfKind(fixture.kind),
    kind: fixture.kind,
    valueSchema: createValueSchema(fixture.kind),
    config: {
      ...(fixture.options ? { options: fixture.options as unknown as JsonValue } : {}),
      ...(fixture.width ? { width: fixture.width } : {}),
    },
    required: fixture.required ?? false,
    isSystemManaged: fixture.systemManaged ?? false,
    systemKey: fixture.systemManaged ? fixture.key : null,
    relationTargetDatasetId: fixture.kind === 'relation' ? 'dataset-members' : null,
    relationCardinality: fixture.relationCardinality ?? null,
    position: index,
    revision: 1,
    archivedAt: null,
  }));

const memberOptions: DatasetOption[] = Array.from({ length: 30 }, (_, index) => ({
  label: `成员 ${String(index + 1).padStart(2, '0')}`,
  value: `member-${index + 1}`,
}));

export const datasetPreviewRelationOptions: Record<string, DatasetOption[]> = Object.fromEntries(
  datasetPreviewFields
    .filter((field) => field.kind === 'relation')
    .map((field) => [field.id, memberOptions]),
);

function fieldValue(field: DatasetFieldDefinition, index: number): JsonValue {
  const sequence = index + 1;
  const day = String((index % 28) + 1).padStart(2, '0');
  const hour = String(index % 24).padStart(2, '0');
  const optionIndex = index % 3;

  if (field.key === 'name') return `成员 ${String(sequence).padStart(5, '0')}`;
  if (field.kind === 'long_text') return `这是第 ${sequence} 行用于验证长文本截断与编辑的模拟内容。`;
  if (field.kind === 'number') return (index * (field.position + 3)) % 10_000;
  if (field.kind === 'checkbox') return index % 3 !== 0;
  if (field.kind === 'date') return `2026-${String((index % 12) + 1).padStart(2, '0')}-${day}`;
  if (field.kind === 'time') return `${hour}:${String((index * 7) % 60).padStart(2, '0')}`;
  if (field.kind === 'datetime') return `2026-08-${day}T${hour}:00`;
  if (field.kind === 'email') return `member${sequence}@example.com`;
  if (field.kind === 'url') return `https://example.com/people/${sequence}`;
  if (field.kind === 'single_select') {
    const options = field.key === 'level' ? levelOptions : selectOptions;
    const value = options[optionIndex]?.value;
    return value ? [value] : [];
  }
  if (field.kind === 'multi_select') {
    return [
      skillOptions[index % skillOptions.length]!.value,
      skillOptions[(index + 1) % skillOptions.length]!.value,
    ];
  }
  if (field.kind === 'json') return { sequence, source: 'preview' };
  return ['北京', '上海', '成都', '深圳'][index % 4] ?? '北京';
}

export function createDatasetPreviewRow(index: number): DatasetTableRow {
  const values: Record<string, JsonValue> = {};
  const relations: Record<string, string | string[]> = {};

  datasetPreviewFields.forEach((field) => {
    if (field.kind === 'relation') {
      relations[field.id] = field.relationCardinality === 'many'
        ? [`member-${(index % 30) + 1}`, `member-${((index + 7) % 30) + 1}`]
        : `member-${(index % 30) + 1}`;
    } else {
      values[field.id] = fieldValue(field, index);
    }
  });

  return {
    id: `row-${index + 1}`,
    datasetId: DATASET_ID,
    values,
    relations,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

export function createDatasetPreviewRows(
  count = DATASET_PREVIEW_ROW_COUNT,
  offset = 0,
): DatasetTableRow[] {
  return Array.from({ length: count }, (_, index) => createDatasetPreviewRow(index + offset));
}

export function createEmptyDatasetPreviewRow(sequence: number): DatasetTableRow {
  const values: Record<string, JsonValue> = {};
  const relations: Record<string, string | string[]> = {};
  datasetPreviewFields.forEach((field) => {
    if (field.kind === 'relation') {
      relations[field.id] = field.relationCardinality === 'many' ? [] : '';
    } else if (field.kind === 'checkbox') {
      values[field.id] = false;
    } else if (field.dataType === 'string[]') {
      values[field.id] = [];
    } else {
      values[field.id] = null;
    }
  });
  values['field-name'] = `新增成员 ${sequence}`;

  return {
    id: `local-row-${sequence}`,
    datasetId: DATASET_ID,
    values,
    relations,
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

export function canonicalizeDatasetPreviewQuery(query: DatasetTableQuery): string {
  return canonicalizeDatasetQuery(query);
}

export function getDatasetPreviewQueryFingerprint(query: DatasetTableQuery): string {
  return getDatasetQueryFingerprint({
    workspaceId: datasetPreviewDataset.workspaceId,
    datasetId: datasetPreviewDataset.id,
    definitionRevision: datasetPreviewDataset.revision,
  }, query);
}

function waitForMockLatency(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Query aborted', 'AbortError'));
      return;
    }
    let timeout: ReturnType<typeof setTimeout>;
    const handleAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Query aborted', 'AbortError'));
    };
    timeout = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, 80);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export async function queryDatasetPreviewWindow(
  rows: readonly DatasetTableRow[],
  fields: readonly DatasetFieldDefinition[],
  request: DatasetWindowQueryRequest,
  signal: AbortSignal,
): Promise<DatasetWindowQueryResponse> {
  await waitForMockLatency(signal);
  const queriedRows = applyDatasetQuery([...rows], [...fields], request.query);
  const startIndex = Math.min(request.window.offset, queriedRows.length);
  return {
    queryFingerprint: getDatasetPreviewQueryFingerprint(request.query),
    totalRowCount: queriedRows.length,
    startIndex,
    items: queriedRows.slice(startIndex, startIndex + request.window.limit),
    ...(request.includeGroupDirectory
      ? { groups: createDatasetGroupDirectory(queriedRows, fields, request.query) }
      : {}),
  };
}
