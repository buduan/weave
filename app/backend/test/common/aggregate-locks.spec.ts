import type { Sql } from '@prisma/client/runtime/library';
import { describe, expect, it, vi } from 'vitest';

import {
  lockDatasetParent,
  lockDatasetRowsByMode,
  lockFormParent,
} from '../../src/common/aggregate-locks';

function queryText(query: Sql): string {
  return query.strings.join('?').replace(/\s+/g, ' ').trim();
}

describe('aggregate lock helpers', () => {
  it('uses the requested parent mode and keeps Dataset before Form', async () => {
    const queries: Sql[] = [];
    const tx = {
      $queryRaw: vi.fn((query: Sql) => {
        queries.push(query);
        return [];
      }),
    };

    await lockDatasetParent(tx as never, 'dataset-1', 'share');
    await lockFormParent(tx as never, 'form-1', 'update');

    expect(queryText(queries[0]!)).toContain('FROM "Dataset"');
    expect(queryText(queries[0]!)).toContain('FOR SHARE');
    expect(queries[0]!.values).toEqual(['dataset-1']);
    expect(queryText(queries[1]!)).toContain('FROM "Form"');
    expect(queryText(queries[1]!)).toContain('FOR UPDATE');
    expect(queries[1]!.values).toEqual(['form-1']);
  });

  it('deduplicates mixed row locks, chooses the strongest mode and sorts IDs', async () => {
    const queries: Sql[] = [];
    const tx = {
      $queryRaw: vi.fn((query: Sql) => {
        queries.push(query);
        const id = query.values[0] as string;
        return [{
          id,
          workspaceId: 1,
          datasetId: 'dataset-1',
          deletedAt: null,
          values: {},
        }];
      }),
    };

    const rows = await lockDatasetRowsByMode(tx as never, [
      { id: 'row-b', mode: 'share' },
      { id: 'row-a', mode: 'share' },
      { id: 'row-b', mode: 'update' },
      { id: 'row-a', mode: 'share' },
    ]);

    expect(queries.map((query) => query.values[0])).toEqual(['row-a', 'row-b']);
    expect(queryText(queries[0]!)).toContain('FOR SHARE');
    expect(queryText(queries[1]!)).toContain('FOR UPDATE');
    expect(rows.map((row) => row.id)).toEqual(['row-a', 'row-b']);
  });
});
