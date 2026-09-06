import {
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import type { DatasetTableRow } from '~/components/dataset/types';
import {
  canonicalizeDatasetPreviewQuery,
  createDatasetPreviewRows,
  DATASET_PREVIEW_FIELD_COUNT,
  DATASET_PREVIEW_ROW_COUNT,
  datasetPreviewFields,
  getDatasetPreviewQueryFingerprint,
  queryDatasetPreviewWindow,
} from '~/fixtures/dataset-preview';

let rows: DatasetTableRow[];

beforeAll(() => {
  rows = createDatasetPreviewRows();
});

describe('Dataset preview Window Query', () => {
  it('covers the approved 5,000-row by 100-field boundary', () => {
    expect(rows).toHaveLength(DATASET_PREVIEW_ROW_COUNT);
    expect(datasetPreviewFields).toHaveLength(DATASET_PREVIEW_FIELD_COUNT);
    expect(Object.keys(rows[0]?.values ?? {})).toHaveLength(96);
  });

  it('returns a bounded distant window without prior windows', async () => {
    const query = { filters: [], sorts: [], group: null };
    const response = await queryDatasetPreviewWindow(rows, datasetPreviewFields, {
      query,
      window: { offset: 4_950, limit: 50 },
    }, new AbortController().signal);

    expect(response.queryFingerprint).toBe(getDatasetPreviewQueryFingerprint(query));
    expect(response.totalRowCount).toBe(5_000);
    expect(response.startIndex).toBe(4_950);
    expect(response.items).toHaveLength(50);
  });

  it('produces the same canonical form and fingerprint for equivalent object-key order', () => {
    const first = {
      filters: [{
        id: 'metadata',
        fieldId: 'field-metadata',
        operator: 'equals' as const,
        value: { source: 'preview', sequence: 1 },
      }],
      sorts: [],
      group: null,
    };
    const second = {
      ...first,
      filters: [{
        ...first.filters[0]!,
        value: { sequence: 1, source: 'preview' },
      }],
    };

    expect(canonicalizeDatasetPreviewQuery(first)).toBe(canonicalizeDatasetPreviewQuery(second));
    expect(getDatasetPreviewQueryFingerprint(first))
      .toBe(getDatasetPreviewQueryFingerprint(second));
  });

  it('builds one complete contiguous directory with full-result aggregates', async () => {
    const response = await queryDatasetPreviewWindow(rows, datasetPreviewFields, {
      query: {
        filters: [],
        sorts: [],
        group: {
          fieldId: 'field-city',
          aggregates: [{
            id: 'score-sum',
            fieldId: 'field-score',
            operation: 'sum',
          }],
        },
      },
      window: { offset: 0, limit: 50 },
      includeGroupDirectory: true,
    }, new AbortController().signal);

    expect(response.groups).toHaveLength(4);
    expect(response.groups?.[0]?.startRowIndex).toBe(0);
    expect(response.groups?.reduce((total, group) => total + group.rowCount, 0)).toBe(5_000);
    expect(response.groups?.every((group) => typeof group.aggregates['score-sum'] === 'number'))
      .toBe(true);
  });

  it('honors AbortSignal for obsolete queries', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(queryDatasetPreviewWindow(rows, datasetPreviewFields, {
      query: { filters: [], sorts: [], group: null },
      window: { offset: 0, limit: 50 },
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
