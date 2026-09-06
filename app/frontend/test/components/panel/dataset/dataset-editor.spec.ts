import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatasetCapabilities } from '@weave/types';
import { datasetPreviewFields } from '~/fixtures/dataset-preview';
import {
  createDatasetCellUpdateRequest,
  getDatasetEditorPath,
  isDatasetEditorReadonly,
  isDatasetQueryFieldAffecting,
  toggleDatasetGroupId,
} from '~/components/panel/dataset/editor-state';

const capabilities: DatasetCapabilities = {
  canUpdateMetadata: true,
  canArchive: true,
  canManageFields: true,
  canCreateRows: true,
  canUpdateRows: true,
  canDeleteRows: true,
};

describe('Dataset editor state mapping', () => {
  it('maps ordinary and relation cell commits to separate partial bodies', () => {
    const text = datasetPreviewFields.find((field) => field.id === 'field-name')!;
    const relation = datasetPreviewFields.find((field) => field.id === 'field-mentor')!;
    expect(createDatasetCellUpdateRequest(text, {
      rowId: 'row-1', fieldId: text.id, value: 'Alice', expectedRevision: 4,
    })).toEqual({ expectedRevision: 4, values: { [text.id]: 'Alice' } });
    expect(createDatasetCellUpdateRequest(relation, {
      rowId: 'row-1', fieldId: relation.id, value: 'row-2', expectedRevision: 4,
    })).toEqual({ expectedRevision: 4, relations: { [relation.id]: 'row-2' } });
  });

  it('refreshes only when the changed field affects the active query', () => {
    const query = {
      filters: [{
        id: 'filter', fieldId: 'field-name', operator: 'contains' as const, value: 'A',
      }],
      sorts: [{ id: 'sort', fieldId: 'field-age', direction: 'asc' as const }],
      group: null,
    };
    expect(isDatasetQueryFieldAffecting(query, 'field-name')).toBe(true);
    expect(isDatasetQueryFieldAffecting(query, 'field-age')).toBe(true);
    expect(isDatasetQueryFieldAffecting(query, 'field-email')).toBe(false);
  });

  it('maps archived and capability-limited editors to readonly', () => {
    expect(isDatasetEditorReadonly('active', capabilities)).toBe(false);
    expect(isDatasetEditorReadonly('archived', capabilities)).toBe(true);
    expect(isDatasetEditorReadonly('active', { ...capabilities, canUpdateRows: false })).toBe(true);
  });

  it('keeps collapsed group state idempotent and produces editor links', () => {
    expect(toggleDatasetGroupId([], 'group-a', true)).toEqual(['group-a']);
    expect(toggleDatasetGroupId(['group-a'], 'group-a', true)).toEqual(['group-a']);
    expect(toggleDatasetGroupId(['group-a'], 'group-a', false)).toEqual([]);
    expect(getDatasetEditorPath('dataset-1')).toBe('/panel/dataset/dataset-1');
  });

  it('retains conflict recovery, lock release, range refresh and relation option states', () => {
    const composable = readFileSync(fileURLToPath(new URL(
      '../../../../composables/useDatasetEditor.ts',
      import.meta.url,
    )), 'utf8');
    expect(composable).toContain("apiError.httpStatus === 409 ? 'conflict'");
    expect(composable).toContain('releaseLock(payload)');
    expect(composable).toContain('windows.refreshRanges(visibleRanges.value)');
    expect(composable).toContain("status: 'loading'");
    expect(composable).toContain('nextCursor: page.nextCursor');
    expect(composable).toContain('selectedIds: selectedIds.length > 0');
    expect(composable).toContain('forbidden: apiError.httpStatus === 403');
  });
});
