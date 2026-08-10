import { describe, expect, it } from 'vitest';
import {
  createDatasetPreviewRows,
  datasetPreviewFields,
} from '~/fixtures/dataset-preview';
import { getDatasetCellFinalizeActions } from './dataset-cell';
import {
  applyDatasetQuery,
  cloneDatasetQuery,
  formatDatasetFieldValue,
  getDatasetFilterOperators,
  parseDatasetFieldInputValue,
} from './dataset-query';
import type { DatasetFieldDefinition } from '@weave/types';
import type { DatasetFilterOperator, DatasetTableQuery } from './types';

function operatorValues(fieldId: string): DatasetFilterOperator[] {
  const field = datasetPreviewFields.find((item) => item.id === fieldId);
  if (!field) throw new Error(`Missing fixture field: ${fieldId}`);
  return getDatasetFilterOperators(field).map((option) => option.value);
}

describe('dataset filter operator matrix', () => {
  it('provides text operators for text-like and JSON fields', () => {
    const expected = ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'];
    ['field-name', 'field-bio', 'field-email', 'field-homepage', 'field-metadata']
      .forEach((fieldId) => {
        expect(operatorValues(fieldId)).toEqual(expected);
      });
  });

  it('provides ordered operators for numeric and temporal fields', () => {
    const expected = ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'];
    ['field-age', 'field-joined_date', 'field-reminder_time', 'field-last_seen_at']
      .forEach((fieldId) => {
        expect(operatorValues(fieldId)).toEqual(expected);
      });
  });

  it('distinguishes boolean, single-value and multi-value fields', () => {
    expect(operatorValues('field-enabled')).toEqual(['equals']);
    expect(operatorValues('field-status')).toEqual(['equals', 'not_equals', 'is_empty', 'is_not_empty']);
    expect(operatorValues('field-mentor')).toEqual(['equals', 'not_equals', 'is_empty', 'is_not_empty']);
    expect(operatorValues('field-skills')).toEqual([
      'contains_any',
      'contains_all',
      'not_contains',
      'is_empty',
      'is_not_empty',
    ]);
    expect(operatorValues('field-team_members')).toEqual([
      'contains_any',
      'contains_all',
      'not_contains',
      'is_empty',
      'is_not_empty',
    ]);
  });
});

describe('applyDatasetQuery', () => {
  it('combines multiple filter rules with AND semantics', () => {
    const rows = createDatasetPreviewRows(20);
    const result = applyDatasetQuery(rows, datasetPreviewFields, {
      filters: [
        {
          id: 'age', fieldId: 'field-age', operator: 'gte', value: 18,
        },
        {
          id: 'enabled', fieldId: 'field-enabled', operator: 'equals', value: true,
        },
        {
          id: 'skills', fieldId: 'field-skills', operator: 'contains_all', value: ['frontend', 'backend'],
        },
      ],
      sorts: [],
      group: null,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((row) => Number(row.values['field-age']) >= 18)).toBe(true);
    expect(result.every((row) => row.values['field-enabled'] === true)).toBe(true);
    expect(result.every((row) => {
      const skills = row.values['field-skills'];
      return Array.isArray(skills) && skills.includes('frontend') && skills.includes('backend');
    })).toBe(true);
  });

  it('uses menu order as stable multi-sort priority', () => {
    const rows = createDatasetPreviewRows(4).map((row, index) => ({
      ...row,
      values: {
        ...row.values,
        'field-city': index < 3 ? '上海' : '北京',
        'field-age': [20, 40, 30, 10][index]!,
      },
    }));
    const result = applyDatasetQuery(rows, datasetPreviewFields, {
      filters: [],
      sorts: [
        { id: 'city', fieldId: 'field-city', direction: 'asc' },
        { id: 'age', fieldId: 'field-age', direction: 'desc' },
      ],
      group: null,
    });

    expect(result.map((row) => row.id)).toEqual(['row-4', 'row-2', 'row-3', 'row-1']);
  });

  it('sorts rows by group and annotates their group key', () => {
    const rows = createDatasetPreviewRows(4).map((row, index) => ({
      ...row,
      values: { ...row.values, 'field-city': index % 2 === 0 ? '深圳' : '北京' },
    }));
    const result = applyDatasetQuery(rows, datasetPreviewFields, {
      filters: [],
      sorts: [],
      group: { fieldId: 'field-city', aggregates: [] },
    });

    expect(result.map((row) => row.values['field-city']))
      .toEqual(['北京', '北京', '深圳', '深圳']);
  });
});

describe('dataset query draft and cell finalization', () => {
  it('keeps applied state unchanged until a cloned draft is explicitly used', () => {
    const applied: DatasetTableQuery = { filters: [], sorts: [], group: null };
    const draft = cloneDatasetQuery(applied);
    draft.filters.push({
      id: 'draft', fieldId: 'field-name', operator: 'contains', value: '成员',
    });

    expect(applied.filters).toHaveLength(0);
    expect(draft.filters).toHaveLength(1);
  });

  it('commits a valid changed draft before releasing its lock', () => {
    expect(getDatasetCellFinalizeActions(true, true)).toEqual(['commit', 'release']);
    expect(getDatasetCellFinalizeActions(false, true)).toEqual(['release']);
    expect(getDatasetCellFinalizeActions(true, false)).toEqual(['release']);
  });
});

describe('Dataset cascader adapters', () => {
  const cascaderField: DatasetFieldDefinition = {
    id: 'field-path',
    datasetId: 'dataset-1',
    key: 'path',
    name: 'Path',
    description: null,
    kind: 'multi_select',
    valueSchema: { type: 'array', items: { type: 'string' } },
    config: {
      optionMode: 'cascader',
      options: [{
        value: 'root',
        label: 'Root',
        i18n: { 'zh-CN': '根' },
        children: [
          { value: 'leaf-a', label: 'Leaf A', i18n: { 'zh-CN': '叶 A' } },
          { value: 'leaf-b', label: 'Leaf B' },
        ],
      }],
    },
    required: true,
    isSystemManaged: false,
    systemKey: null,
    relationTargetDatasetId: null,
    relationCardinality: null,
    position: 0,
    revision: 1,
    archivedAt: null,
  };

  it('parses exactly one complete root-to-leaf path', () => {
    expect(parseDatasetFieldInputValue(cascaderField, ['root', 'leaf-a']))
      .toEqual({ valid: true, value: ['root', 'leaf-a'] });
    expect(parseDatasetFieldInputValue(cascaderField, ['root']).valid).toBe(false);
    expect(parseDatasetFieldInputValue(cascaderField, ['root', 'missing']).valid).toBe(false);
  });

  it('displays the ordered localized path instead of a flat multi-select list', () => {
    expect(formatDatasetFieldValue(cascaderField, ['root', 'leaf-a'], 'zh-CN'))
      .toBe('根 / 叶 A');
    expect(formatDatasetFieldValue(cascaderField, ['root', 'leaf-b'], 'en'))
      .toBe('Root / Leaf B');
  });
});
