import { describe, expect, it } from 'vitest';
import {
  buildDatasetDisplayItems,
  DATASET_GROUP_HEADER_HEIGHT,
  DATASET_ROW_HEIGHT,
  getDatasetDisplayItemOffset,
  getDatasetRowRanges,
  validateDatasetGroupDirectory,
} from '~/components/dataset/dataset-display';
import type { DatasetGroupSummary } from '~/components/dataset/types';

const groups: DatasetGroupSummary[] = [
  {
    groupId: 'a',
    groupKey: 'A',
    startRowIndex: 0,
    rowCount: 2,
    aggregates: {},
  },
  {
    groupId: 'b',
    groupKey: 'B',
    startRowIndex: 2,
    rowCount: 3,
    aggregates: {},
  },
  {
    groupId: 'c',
    groupKey: 'C',
    startRowIndex: 5,
    rowCount: 2,
    aggregates: {},
  },
];

describe('Dataset display-item mapping', () => {
  it('builds the full ungrouped fake space by absolute row index', () => {
    const items = buildDatasetDisplayItems(5_000, null, new Set());

    expect(items).toHaveLength(5_000);
    expect(items[4_999]).toEqual({ key: 'row:4999', kind: 'row', rowIndex: 4_999 });
  });

  it('keeps group headers while omitting collapsed data rows', () => {
    const items = buildDatasetDisplayItems(7, groups, new Set(['b']));

    expect(items).toHaveLength(7);
    expect(items.map((item) => item.key)).toEqual([
      'group:a',
      'row:0',
      'row:1',
      'group:b',
      'group:c',
      'row:5',
      'row:6',
    ]);
    expect(getDatasetRowRanges(items)).toEqual([
      { startIndex: 0, endIndex: 1 },
      { startIndex: 5, endIndex: 6 },
    ]);
  });

  it('validates complete contiguous group directories before mapping', () => {
    expect(validateDatasetGroupDirectory(7, groups)).toBeNull();
    expect(validateDatasetGroupDirectory(8, groups)).toContain('与总行数');
    expect(validateDatasetGroupDirectory(7, [
      groups[0]!,
      { ...groups[1]!, startRowIndex: 3 },
    ])).toContain('起始索引不连续');
    expect(validateDatasetGroupDirectory(4, [groups[0]!, { ...groups[0]! }]))
      .toContain('重复');
  });

  it('uses exact fixed geometry without mutating directory inputs', () => {
    const frozenGroups = Object.freeze(groups.map((group) => Object.freeze({ ...group })));
    const items = buildDatasetDisplayItems(7, frozenGroups, new Set(['a']));
    const groupBIndex = items.findIndex((item) => item.key === 'group:b');

    expect(getDatasetDisplayItemOffset(items, groupBIndex))
      .toBe(DATASET_GROUP_HEADER_HEIGHT);
    expect(getDatasetDisplayItemOffset(items, groupBIndex + 1))
      .toBe(DATASET_GROUP_HEADER_HEIGHT * 2);
    expect(DATASET_ROW_HEIGHT).toBe(44);
    expect(DATASET_GROUP_HEADER_HEIGHT).toBe(56);
    expect(frozenGroups).toHaveLength(3);
  });
});
