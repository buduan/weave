import type {
  DatasetAggregateOperation,
  DatasetAggregateRule,
  DatasetFieldDefinition,
  DatasetFieldKind,
  DatasetFilterOperator,
  DatasetFilterRule,
  DatasetGroupSummary,
  DatasetOption,
  DatasetRowData,
  DatasetTableQuery,
  DatasetWindowQueryScope,
  JsonValue,
} from '@weave/types';
import { cloneJson } from './json-clone';
import {
  isCompleteChoicePath,
  normalizeDatasetChoiceConfig,
  resolveDatasetChoicePathLabels,
} from './dataset-choices';
import { canonicalizeJson } from './json';
import { isEmptyJsonValue } from './json-guards';

export interface DatasetFilterOperatorOption {
  label: string;
  value: DatasetFilterOperator;
  requiresValue: boolean;
}

const EMPTY_OPERATORS: DatasetFilterOperatorOption[] = [
  { label: '为空', value: 'is_empty', requiresValue: false },
  { label: '不为空', value: 'is_not_empty', requiresValue: false },
];

const TEXT_OPERATORS: DatasetFilterOperatorOption[] = [
  { label: '包含', value: 'contains', requiresValue: true },
  { label: '等于', value: 'equals', requiresValue: true },
  { label: '不等于', value: 'not_equals', requiresValue: true },
  ...EMPTY_OPERATORS,
];

const ORDERED_OPERATORS: DatasetFilterOperatorOption[] = [
  { label: '等于', value: 'equals', requiresValue: true },
  { label: '不等于', value: 'not_equals', requiresValue: true },
  { label: '大于', value: 'gt', requiresValue: true },
  { label: '大于等于', value: 'gte', requiresValue: true },
  { label: '小于', value: 'lt', requiresValue: true },
  { label: '小于等于', value: 'lte', requiresValue: true },
  ...EMPTY_OPERATORS,
];

const SINGLE_VALUE_OPERATORS: DatasetFilterOperatorOption[] = [
  { label: '等于', value: 'equals', requiresValue: true },
  { label: '不等于', value: 'not_equals', requiresValue: true },
  ...EMPTY_OPERATORS,
];

const MULTI_VALUE_OPERATORS: DatasetFilterOperatorOption[] = [
  { label: '包含任一', value: 'contains_any', requiresValue: true },
  { label: '包含全部', value: 'contains_all', requiresValue: true },
  { label: '不包含', value: 'not_contains', requiresValue: true },
  ...EMPTY_OPERATORS,
];

export const EMPTY_DATASET_QUERY: DatasetTableQuery = {
  filters: [],
  sorts: [],
  group: null,
};

export function cloneDatasetQuery(query: DatasetTableQuery): DatasetTableQuery {
  return cloneJson(query);
}

export function canonicalizeDatasetQuery(query: DatasetTableQuery): string {
  return canonicalizeJson({
    filters: query.filters.map((rule) => ({
      id: rule.id,
      fieldId: rule.fieldId,
      operator: rule.operator,
      ...(rule.value === undefined ? {} : { value: rule.value }),
    })),
    sorts: query.sorts.map((rule) => ({
      id: rule.id,
      fieldId: rule.fieldId,
      direction: rule.direction,
    })),
    group: query.group === null
      ? null
      : {
        fieldId: query.group.fieldId,
        aggregates: query.group.aggregates.map((rule) => ({
          id: rule.id,
          fieldId: rule.fieldId,
          operation: rule.operation,
        })),
      },
  });
}

export function hashDatasetQuery(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) % 2147483647;
  }
  return hash.toString(36);
}

export function getDatasetQueryFingerprint(
  scope: DatasetWindowQueryScope,
  query: DatasetTableQuery,
): string {
  return `dataset-${hashDatasetQuery(canonicalizeJson({
    workspaceId: scope.workspaceId,
    datasetId: scope.datasetId,
    definitionRevision: scope.definitionRevision,
    query: canonicalizeDatasetQuery(query),
  }))}`;
}

export function isDatasetQueryEmpty(query: DatasetTableQuery): boolean {
  return query.filters.length === 0 && query.sorts.length === 0 && query.group === null;
}

export function getDatasetFilterOperators(
  field: DatasetFieldDefinition,
): DatasetFilterOperatorOption[] {
  if (field.kind === 'boolean') {
    return [{ label: '等于', value: 'equals', requiresValue: true }];
  }
  if (['number', 'date', 'time', 'datetime'].includes(field.kind)) {
    return ORDERED_OPERATORS;
  }
  if (field.kind === 'multi_select'
    || (field.kind === 'relation' && field.relationCardinality === 'many')) {
    return MULTI_VALUE_OPERATORS;
  }
  if (field.kind === 'single_select' || field.kind === 'relation') {
    return SINGLE_VALUE_OPERATORS;
  }
  return TEXT_OPERATORS;
}

export function getDatasetFieldOptions(
  field: DatasetFieldDefinition,
  relationOptions: Record<string, DatasetOption[]> = {},
): DatasetOption[] {
  if (field.kind === 'relation') return relationOptions[field.id] ?? [];
  if (field.kind !== 'single_select' && field.kind !== 'multi_select') return [];
  try {
    const choiceConfig = normalizeDatasetChoiceConfig(field.kind, field.config);
    return choiceConfig.options.map(({ label, value }) => ({ label, value }));
  } catch {
    return [];
  }
}

export function isDatasetFieldGroupable(field: DatasetFieldDefinition): boolean {
  return field.kind !== 'long_text'
    && field.kind !== 'multi_select'
    && field.kind !== 'json'
    && !(field.kind === 'relation' && field.relationCardinality === 'many');
}

export function getDatasetAggregateOperations(
  field: DatasetFieldDefinition,
): DatasetAggregateOperation[] {
  if (field.kind === 'number') return ['sum', 'avg', 'min', 'max', 'count_non_empty'];
  if (field.kind === 'date' || field.kind === 'time' || field.kind === 'datetime') {
    return ['min', 'max', 'count_non_empty'];
  }
  return isDatasetFieldGroupable(field) ? ['count_non_empty'] : [];
}

export function getDatasetCellValue(
  row: DatasetRowData,
  field: DatasetFieldDefinition,
): JsonValue {
  return field.kind === 'relation'
    ? row.relations[field.id] ?? null
    : row.values[field.id] ?? null;
}

function normalizeComparableValue(value: JsonValue, kind: DatasetFieldKind): number | string {
  if (kind === 'number') {
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(numberValue) ? Number.NEGATIVE_INFINITY : numberValue;
  }
  if (kind === 'boolean') return value === true ? 1 : 0;
  if (typeof value === 'object' && value !== null) return canonicalizeJson(value);
  return String(value ?? '').toLocaleLowerCase();
}

function asStringArray(value: JsonValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value === undefined || value === null || value === '' ? [] : [String(value)];
}

function matchesFilter(
  row: DatasetRowData,
  field: DatasetFieldDefinition,
  rule: DatasetFilterRule,
): boolean {
  const cellValue = getDatasetCellValue(row, field);
  const filterValue = rule.value ?? null;
  if (rule.operator === 'is_empty') return isEmptyJsonValue(cellValue);
  if (rule.operator === 'is_not_empty') return !isEmptyJsonValue(cellValue);
  if (rule.operator === 'contains_any'
    || rule.operator === 'contains_all'
    || rule.operator === 'not_contains') {
    const cellValues = asStringArray(cellValue);
    const filterValues = asStringArray(rule.value);
    const hasAny = filterValues.some((value) => cellValues.includes(value));
    const hasAll = filterValues.every((value) => cellValues.includes(value));
    if (rule.operator === 'contains_any') return hasAny;
    if (rule.operator === 'contains_all') return hasAll;
    return !hasAny;
  }
  const left = normalizeComparableValue(cellValue, field.kind);
  const right = normalizeComparableValue(filterValue, field.kind);
  if (rule.operator === 'contains') return String(left).includes(String(right));
  if (rule.operator === 'equals') return left === right;
  if (rule.operator === 'not_equals') return left !== right;
  if (rule.operator === 'gt') return left > right;
  if (rule.operator === 'gte') return left >= right;
  if (rule.operator === 'lt') return left < right;
  if (rule.operator === 'lte') return left <= right;
  return true;
}

function compareValues(left: JsonValue, right: JsonValue, kind: DatasetFieldKind): number {
  const leftEmpty = isEmptyJsonValue(left);
  const rightEmpty = isEmptyJsonValue(right);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  const normalizedLeft = normalizeComparableValue(left, kind);
  const normalizedRight = normalizeComparableValue(right, kind);
  if (typeof normalizedLeft === 'number' && typeof normalizedRight === 'number') {
    return normalizedLeft - normalizedRight;
  }
  return String(normalizedLeft).localeCompare(String(normalizedRight), 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

export function formatDatasetCellValue(value: JsonValue): string {
  if (value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map(String).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Format a Dataset value with current choice labels, including cascader path semantics. */
export function formatDatasetFieldValue(
  field: DatasetFieldDefinition,
  value: JsonValue,
  locale = 'zh-CN',
): string {
  if ((field.kind === 'single_select' || field.kind === 'multi_select')) {
    try {
      const config = normalizeDatasetChoiceConfig(field.kind, field.config);
      if (config.optionMode === 'cascader') {
        return resolveDatasetChoicePathLabels(config.options, value, locale)?.join(' / ')
          ?? formatDatasetCellValue(value);
      }
      const labels = new Map(config.options.map((option) => [
        option.value,
        option.i18n?.[locale] || option.label,
      ]));
      if (Array.isArray(value)) {
        return value.map((item) => labels.get(String(item)) ?? String(item)).join('、');
      }
      return labels.get(String(value)) ?? formatDatasetCellValue(value);
    } catch {
      return formatDatasetCellValue(value);
    }
  }
  return formatDatasetCellValue(value);
}

/** 将表单控件草稿解析为 Dataset JSON 值，供单元格与整行对话框共用。 */
export function parseDatasetFieldInputValue(
  field: DatasetFieldDefinition,
  input: unknown,
): { valid: boolean; value: JsonValue } {
  if (field.kind === 'boolean') return { value: input === true, valid: true };
  if (field.kind === 'number') {
    if (input === '' || input === null || input === undefined) {
      return { value: null, valid: !field.required };
    }
    const value = Number(input);
    return { value: Number.isNaN(value) ? null : value, valid: !Number.isNaN(value) };
  }
  if (field.kind === 'multi_select'
    || (field.kind === 'relation' && field.relationCardinality === 'many')) {
    const value = Array.isArray(input) ? input.map(String) : [];
    if (field.kind === 'multi_select') {
      try {
        const config = normalizeDatasetChoiceConfig(field.kind, field.config);
        if (config.optionMode === 'cascader') {
          return {
            value,
            valid: (!field.required && value.length === 0)
              || isCompleteChoicePath(config.options, value),
          };
        }
      } catch {
        return { value, valid: false };
      }
    }
    return { value, valid: !field.required || value.length > 0 };
  }
  if (field.kind === 'json') {
    if (input === '' || input === null || input === undefined) {
      return { value: null, valid: !field.required };
    }
    try {
      return {
        value: typeof input === 'string' ? JSON.parse(input) as JsonValue : input as JsonValue,
        valid: true,
      };
    } catch {
      return { value: null, valid: false };
    }
  }
  const value = input === null || input === undefined ? '' : String(input);
  return {
    value: value === '' ? null : value,
    valid: !field.required || value.length > 0,
  };
}

export function applyDatasetQuery(
  rows: DatasetRowData[],
  fields: DatasetFieldDefinition[],
  query: DatasetTableQuery,
): DatasetRowData[] {
  if (isDatasetQueryEmpty(query)) return rows;
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const filteredRows = rows.filter((row) => query.filters.every((rule) => {
    const field = fieldsById.get(rule.fieldId);
    return field ? matchesFilter(row, field, rule) : true;
  }));
  const groupField = query.group ? fieldsById.get(query.group.fieldId) : undefined;
  return filteredRows
    .map((row, index) => ({ row, index }))
    .sort((leftEntry, rightEntry) => {
      if (groupField) {
        const grouped = compareValues(
          getDatasetCellValue(leftEntry.row, groupField),
          getDatasetCellValue(rightEntry.row, groupField),
          groupField.kind,
        );
        if (grouped !== 0) return grouped;
      }
      const sorted = query.sorts.reduce((result, rule) => {
        if (result !== 0) return result;
        const field = fieldsById.get(rule.fieldId);
        if (!field) return result;
        const compared = compareValues(
          getDatasetCellValue(leftEntry.row, field),
          getDatasetCellValue(rightEntry.row, field),
          field.kind,
        );
        return rule.direction === 'asc' ? compared : -compared;
      }, 0);
      return sorted === 0 ? leftEntry.index - rightEntry.index : sorted;
    })
    .map(({ row }) => row);
}

function aggregateRows(
  rows: readonly DatasetRowData[],
  fields: readonly DatasetFieldDefinition[],
  rule: DatasetAggregateRule,
): JsonValue {
  const field = fields.find((item) => item.id === rule.fieldId);
  if (!field) return null;
  const values = rows
    .map((row) => getDatasetCellValue(row, field))
    .filter((value) => !isEmptyJsonValue(value));
  if (rule.operation === 'count_non_empty') return values.length;
  if (values.length === 0) return null;
  if (field.kind === 'number') {
    const numbers = values.map(Number).filter(Number.isFinite);
    if (numbers.length === 0) return null;
    const sum = numbers.reduce((total, value) => total + value, 0);
    if (rule.operation === 'sum') return sum;
    if (rule.operation === 'avg') return sum / numbers.length;
    return rule.operation === 'min' ? Math.min(...numbers) : Math.max(...numbers);
  }
  const strings = values.map(String).sort((left, right) => left.localeCompare(right));
  return rule.operation === 'min' ? strings[0] ?? null : strings.at(-1) ?? null;
}

export function createDatasetGroupDirectory(
  rows: readonly DatasetRowData[],
  fields: readonly DatasetFieldDefinition[],
  query: DatasetTableQuery,
): DatasetGroupSummary[] | undefined {
  const groupRule = query.group;
  if (!groupRule) return undefined;
  const field = fields.find((item) => item.id === groupRule.fieldId);
  if (!field) return [];
  const groups: Array<{
    key: JsonValue;
    startRowIndex: number;
    rows: DatasetRowData[];
  }> = [];
  rows.forEach((row, rowIndex) => {
    const key = getDatasetCellValue(row, field);
    const previous = groups.at(-1);
    if (!previous || canonicalizeJson(previous.key) !== canonicalizeJson(key)) {
      groups.push({ key, startRowIndex: rowIndex, rows: [row] });
    } else {
      previous.rows.push(row);
    }
  });
  return groups.map((group) => ({
    groupId: `group-${hashDatasetQuery(`${field.id}:${canonicalizeJson(group.key)}`)}`,
    groupKey: group.key,
    startRowIndex: group.startRowIndex,
    rowCount: group.rows.length,
    aggregates: Object.fromEntries(groupRule.aggregates.map((rule) => [
      rule.id,
      aggregateRows(group.rows, fields, rule),
    ])),
  }));
}
