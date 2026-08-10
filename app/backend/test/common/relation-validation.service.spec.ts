import { BadRequestException } from '@nestjs/common';
import type { Sql } from '@prisma/client/runtime/library';
import { describe, expect, it, vi } from 'vitest';

import { RelationValidationService } from '../../src/common/relation-validation.service';

function lockedRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: 1,
    datasetId: 'target-dataset',
    deletedAt: null,
    values: { label: id },
    ...overrides,
  };
}

describe('RelationValidationService', () => {
  const fields = [{ id: 'relation-field', relationTargetDatasetId: 'target-dataset' }];

  it('threads the transaction through sorted, deduplicated target locks and returns values', async () => {
    const queries: Sql[] = [];
    const tx = {
      $queryRaw: vi.fn((query: Sql) => {
        queries.push(query);
        return [lockedRow(query.values[0] as string)];
      }),
    };
    const relations = new Map([
      ['relation-field', ['row-b', 'row-a', 'row-b']],
    ]);

    const rows = await new RelationValidationService().validate(
      tx as never,
      1,
      fields,
      relations,
    );

    expect(queries.map((query) => query.values[0])).toEqual(['row-a', 'row-b']);
    expect(queries.every((query) => query.strings.join('').includes('FOR SHARE'))).toBe(true);
    expect(rows).toEqual([lockedRow('row-a'), lockedRow('row-b')]);
  });

  it('locks an updated source row in the same global order with the stronger mode', async () => {
    const queries: Sql[] = [];
    const tx = {
      $queryRaw: vi.fn((query: Sql) => {
        queries.push(query);
        const id = query.values[0] as string;
        return id === 'source-row' ? [lockedRow(id, { datasetId: 'source-dataset' })] : [lockedRow(id)];
      }),
    };

    await new RelationValidationService().validate(
      tx as never,
      1,
      fields,
      new Map([['relation-field', ['target-row']]]),
      { updateRowIds: ['source-row'] },
    );

    expect(queries.map((query) => query.values[0])).toEqual(['source-row', 'target-row']);
    expect(queries[0]!.strings.join('')).toContain('FOR UPDATE');
    expect(queries[1]!.strings.join('')).toContain('FOR SHARE');
  });

  it.each([
    ['missing', undefined],
    ['deleted', lockedRow('row-a', { deletedAt: new Date() })],
    ['workspace', lockedRow('row-a', { workspaceId: 2 })],
    ['dataset', lockedRow('row-a', { datasetId: 'wrong-dataset' })],
  ])('rejects an invalid %s target', async (_caseId, row) => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue(row ? [row] : []) };

    await expect(new RelationValidationService().validate(
      tx as never,
      1,
      fields,
      new Map([['relation-field', ['row-a']]]),
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});
