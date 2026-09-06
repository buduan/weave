import { describe, expectTypeOf, it } from 'vitest';
import type { CreateDatasetRowRequest } from '@weave/types';
import type {
  DatasetCellCommitPayload,
  DatasetGroupSummary,
  DatasetRowRange,
  DatasetSelection,
  DatasetTableEmits,
  DatasetTableProps,
  DatasetTableRow,
} from '~/components/dataset/types';

describe('DatasetTable controlled contract', () => {
  it('types sparse props as parent-owned inputs', () => {
    expectTypeOf<DatasetTableProps['rowSlots']>()
      .toEqualTypeOf<Readonly<Record<number, DatasetTableRow | undefined>>>();
    expectTypeOf<DatasetTableProps['groupDirectory']>()
      .toEqualTypeOf<DatasetGroupSummary[] | null | undefined>();
  });

  it('types query, range, mutation and selection intents explicitly', () => {
    expectTypeOf<DatasetTableEmits['cell-commit-request']>()
      .toEqualTypeOf<[payload: DatasetCellCommitPayload]>();
    expectTypeOf<DatasetTableEmits['window-range-request']>()
      .toEqualTypeOf<[ranges: DatasetRowRange[]]>();
    expectTypeOf<DatasetTableEmits['selection-change']>()
      .toEqualTypeOf<[selection: DatasetSelection]>();
    expectTypeOf<DatasetTableEmits['row-create-request']>()
      .toEqualTypeOf<[input: CreateDatasetRowRequest]>();
    expectTypeOf<DatasetCellCommitPayload['expectedRevision']>().toEqualTypeOf<number>();
    expectTypeOf<DatasetTableProps['rowCreateActive']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<DatasetTableProps['rowCreateError']>().toEqualTypeOf<string | null | undefined>();
  });
});
