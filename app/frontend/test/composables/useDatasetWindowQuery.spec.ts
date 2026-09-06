import { describe, expect, it } from 'vitest';
import {
  DATASET_WINDOW_SIZE,
  getDatasetWindowOffsets,
  getDatasetWindowQueryKey,
  replaceLoadedDatasetRow,
} from '~/components/dataset/dataset-window';
import { createDatasetPreviewRow } from '~/fixtures/dataset-preview';

describe('Dataset absolute window planning', () => {
  it('deduplicates overlapping ranges and adds at most one adjacent prefetch', () => {
    expect(getDatasetWindowOffsets([
      { startIndex: 45, endIndex: 54 },
      { startIndex: 50, endIndex: 80 },
    ], 5_000)).toEqual([0, 50, 100]);
  });

  it('plans separated ranges without filling a collapsed gap', () => {
    expect(getDatasetWindowOffsets([
      { startIndex: 0, endIndex: 10 },
      { startIndex: 4_500, endIndex: 4_510 },
    ], 5_000, false)).toEqual([0, 4_500]);
  });

  it('directly plans the final distant window', () => {
    expect(getDatasetWindowOffsets([
      { startIndex: 4_950, endIndex: 4_999 },
    ], 5_000)).toEqual([4_950]);
    expect(DATASET_WINDOW_SIZE).toBe(50);
  });

  it('keys independent windows by scope, revision, canonical query and offset', () => {
    expect(getDatasetWindowQueryKey({
      workspaceId: 1,
      datasetId: 'dataset-preview',
      definitionRevision: 7,
    }, '{"filters":[]}', 4_500)).toEqual([
      'dataset-window',
      1,
      'dataset-preview',
      7,
      '{"filters":[]}',
      4_500,
      50,
    ]);
  });

  it('replaces only an already-loaded row without changing absolute indexes', () => {
    const row = createDatasetPreviewRow(12);
    const updated = { ...row, revision: 2 };
    expect(replaceLoadedDatasetRow({ 4_512: row }, updated)).toEqual({ 4_512: updated });
    expect(replaceLoadedDatasetRow({ 4_512: row }, createDatasetPreviewRow(13))).toBeNull();
  });
});
