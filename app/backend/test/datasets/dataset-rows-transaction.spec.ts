import { ConflictException } from '@nestjs/common';
import { DatasetStatus, DatasetType } from '@prisma/client';
import type { Sql } from '@prisma/client/runtime/library';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedActor } from '@weave/types';

import { DatasetRowsService } from '../../src/datasets/dataset-rows.service';

const actor: AuthenticatedActor = {
  userId: 'user-1',
  workspaceId: 1,
  sessionId: 'session-1',
  permissions: ['dataset.manage_all'],
  isSystemAdmin: false,
  isWorkspaceAdmin: false,
};

function activeDataset() {
  return {
    id: 'dataset-1',
    workspaceId: 1,
    status: DatasetStatus.active,
    type: DatasetType.standard,
  };
}

describe('DatasetRowsService transaction boundaries', () => {
  it('threads the transaction through current fields, relation locking and every create write', async () => {
    const field = {
      id: 'relation-field',
      relationTargetDatasetId: 'target-dataset',
    };
    const relations = new Map([['relation-field', ['target-row']]]);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      dataset: { findUnique: vi.fn().mockResolvedValue(activeDataset()) },
      datasetField: { findMany: vi.fn().mockResolvedValue([field]) },
      datasetRow: {
        create: vi.fn().mockResolvedValue({
          id: 'source-row',
          revision: 1,
          values: {},
          deletedAt: null,
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
          updatedAt: new Date('2026-08-10T00:00:00.000Z'),
        }),
      },
      datasetRelation: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      datasetRowVersion: { create: vi.fn().mockResolvedValue({ id: 'version-1' }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const schemas = {
      validateRow: vi.fn().mockReturnValue({ values: {}, relations }),
    };
    const audit = { record: vi.fn() };
    const relationValidation = { validate: vi.fn().mockResolvedValue([]) };
    const service = new DatasetRowsService(
      prisma as never,
      { assertCanCreateRows: vi.fn() } as never,
      schemas as never,
      audit as never,
      relationValidation as never,
    );

    await service.create(1, 'dataset-1', {
      values: {},
      relations: { 'relation-field': ['target-row'] },
    }, actor);

    expect(relationValidation.validate).toHaveBeenCalledWith(
      tx,
      1,
      [field],
      relations,
    );
    expect(tx.datasetRelation.createMany).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dataset.row.create',
    }), tx);
  });

  it('locks the target row before counting incoming relations and performs no rejected writes', async () => {
    const events: string[] = [];
    const tx = {
      $queryRaw: vi.fn((query: Sql) => {
        const table = query.strings.join('').includes('DatasetRow') ? 'row-lock' : 'dataset-lock';
        events.push(table);
        return [];
      }),
      dataset: {
        findUnique: vi.fn(() => {
          events.push('dataset-read');
          return activeDataset();
        }),
      },
      datasetRow: {
        findUnique: vi.fn(() => {
          events.push('row-read');
          return {
            id: 'row-1',
            revision: 1,
            deletedAt: null,
            values: {},
            sourceRelations: [],
          };
        }),
        updateMany: vi.fn(),
      },
      datasetRelation: {
        count: vi.fn(() => {
          events.push('incoming-count');
          return 1;
        }),
      },
      datasetRowVersion: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: vi.fn() };
    const service = new DatasetRowsService(
      prisma as never,
      { assertCanDeleteRows: vi.fn() } as never,
      {} as never,
      audit as never,
      {} as never,
    );

    await expect(service.softDelete(1, 'dataset-1', 'row-1', 1, actor))
      .rejects.toBeInstanceOf(ConflictException);

    expect(events).toEqual([
      'dataset-lock',
      'dataset-read',
      'row-lock',
      'row-read',
      'incoming-count',
    ]);
    expect(tx.datasetRow.updateMany).not.toHaveBeenCalled();
    expect(tx.datasetRowVersion.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'ReadCommitted' }),
    );
  });

  it('keeps update row re-read, target locks, CAS, relation and audit writes on one client', async () => {
    const field = { id: 'relation-field', relationTargetDatasetId: 'target-dataset' };
    const relations = new Map([['relation-field', ['target-row']]]);
    const now = new Date('2026-08-10T00:00:00.000Z');
    const row = {
      id: 'source-row',
      revision: 1,
      values: {},
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      dataset: { findUnique: vi.fn().mockResolvedValue(activeDataset()) },
      datasetField: { findMany: vi.fn().mockResolvedValue([field]) },
      datasetRow: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(row)
          .mockResolvedValueOnce({ ...row, sourceRelations: [] }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...row, revision: 2 }),
      },
      datasetRelation: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      datasetRowVersion: { create: vi.fn().mockResolvedValue({ id: 'version-2' }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const schemas = {
      validateRow: vi.fn().mockReturnValue({ values: {}, relations }),
    };
    const audit = { record: vi.fn() };
    const relationValidation = { validate: vi.fn().mockResolvedValue([]) };
    const service = new DatasetRowsService(
      prisma as never,
      { assertCanUpdateRows: vi.fn() } as never,
      schemas as never,
      audit as never,
      relationValidation as never,
    );

    await service.update(1, 'dataset-1', 'source-row', {
      expectedRevision: 1,
      values: {},
      relations: { 'relation-field': ['target-row'] },
    }, actor);

    expect(relationValidation.validate).toHaveBeenCalledWith(
      tx,
      1,
      [field],
      relations,
      { updateRowIds: ['source-row'] },
    );
    expect(tx.datasetRow.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.datasetRow.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.datasetRelation.deleteMany).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dataset.row.update',
    }), tx);
  });

  it('fully revalidates restore snapshots and relations inside the locked transaction', async () => {
    const field = { id: 'relation-field', relationTargetDatasetId: 'target-dataset' };
    const relations = new Map([['relation-field', ['target-row']]]);
    const now = new Date('2026-08-10T00:00:00.000Z');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      dataset: { findUnique: vi.fn().mockResolvedValue(activeDataset()) },
      datasetField: { findMany: vi.fn().mockResolvedValue([field]) },
      datasetRowVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'historical-version',
          rowId: 'source-row',
          valuesSnapshot: {},
          relationsSnapshot: { 'relation-field': ['target-row'] },
        }),
        create: vi.fn().mockResolvedValue({ id: 'restore-version' }),
      },
      datasetRow: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'source-row',
          revision: 2,
          deletedAt: now,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'source-row',
          revision: 3,
          values: {},
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        }),
      },
      datasetRelation: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const schemas = {
      validateRow: vi.fn().mockReturnValue({ values: {}, relations }),
    };
    const audit = { record: vi.fn() };
    const relationValidation = { validate: vi.fn().mockResolvedValue([]) };
    const service = new DatasetRowsService(
      prisma as never,
      {
        assertCanManage: vi.fn().mockResolvedValue(activeDataset()),
      } as never,
      schemas as never,
      audit as never,
      relationValidation as never,
    );

    await service.restore(1, 'dataset-1', 'source-row', 'historical-version', 2, actor);

    expect(schemas.validateRow).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'relation-field', isSystemManaged: false })],
      {
        values: {},
        relations: { 'relation-field': ['target-row'] },
      },
    );
    expect(relationValidation.validate).toHaveBeenCalledWith(
      tx,
      1,
      [field],
      relations,
      { updateRowIds: ['source-row'] },
    );
    expect(tx.datasetRelation.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.datasetRowVersion.create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dataset.row.restore',
    }), tx);
  });
});
