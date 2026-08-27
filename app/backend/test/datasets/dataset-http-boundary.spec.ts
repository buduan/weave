import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DatasetCollaboratorRole,
  DatasetStatus,
  DatasetType,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  AuthenticatedActor,
  DatasetCapabilities,
  DatasetDetailResponse,
  DatasetFieldDefinition,
} from '@weave/types';

import { DatasetRowsService } from '../../src/datasets/dataset-rows.service';
import {
  CreateDatasetDto,
  DatasetRelationOptionsDto,
  DatasetWindowQueryDto,
} from '../../src/datasets/datasets.dto';
import { DatasetsService } from '../../src/datasets/datasets.service';

const actor: AuthenticatedActor = {
  userId: 'user-1',
  workspaceId: 1,
  sessionId: 'session-1',
  permissions: ['dataset.manage_all'],
  isSystemAdmin: false,
  isWorkspaceAdmin: false,
};

function capability(
  type: DatasetType,
  status = DatasetStatus.active,
): DatasetCapabilities {
  const service = new DatasetsService({} as never, {} as never, {} as never);
  const internal = service as unknown as {
    capabilitiesFor: (
      dataset: { status: DatasetStatus; type: DatasetType },
      currentActor: AuthenticatedActor,
      role?: DatasetCollaboratorRole,
    ) => DatasetCapabilities;
  };
  return internal.capabilitiesFor({ status, type }, actor, DatasetCollaboratorRole.owner);
}

const field: DatasetFieldDefinition = {
  id: 'field-name',
  datasetId: 'dataset-1',
  key: 'name',
  name: 'Name',
  description: null,
  dataType: 'string',
  kind: 'text',
  valueSchema: { type: 'string' },
  config: {},
  required: false,
  isSystemManaged: false,
  systemKey: null,
  relationTargetDatasetId: null,
  relationCardinality: null,
  position: 0,
  revision: 1,
  archivedAt: null,
};

function detail(fields = [field]): DatasetDetailResponse {
  return {
    dataset: {
      id: 'dataset-1',
      workspaceId: 1,
      name: 'Dataset',
      slug: 'dataset',
      description: null,
      type: 'standard',
      status: 'active',
      subjectMode: 'none',
      revision: 3,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
    fields,
    creator: { id: 'user-1', displayName: 'User', avatarUrl: null },
    capabilities: capability(DatasetType.standard),
  };
}

describe('Dataset DTO boundary', () => {
  it('rejects unknown Dataset metadata keys', async () => {
    const dto = plainToInstance(CreateDatasetDto, {
      name: 'People',
      slug: 'people',
      type: 'standard',
      unexpected: true,
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((error) => error.property === 'unexpected')).toBe(true);
  });

  it('rejects row windows above 100', async () => {
    const dto = plainToInstance(DatasetWindowQueryDto, {
      query: { filters: [], sorts: [], group: null },
      window: { offset: 0, limit: 101 },
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).not.toHaveLength(0);
  });

  it('normalizes one selected relation query value to an array', async () => {
    const dto = plainToInstance(DatasetRelationOptionsDto, { selectedIds: 'row-1' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
    expect(dto.selectedIds).toEqual(['row-1']);
  });
});

describe('Dataset capability matrix', () => {
  it('allows every generic mutation only for standard Datasets', () => {
    expect(capability(DatasetType.standard)).toEqual({
      canUpdateMetadata: true,
      canArchive: true,
      canManageFields: true,
      canCreateRows: true,
      canUpdateRows: true,
      canDeleteRows: true,
    });
  });

  it('limits member and join-request generic row mutations', () => {
    expect(capability(DatasetType.members)).toMatchObject({
      canUpdateMetadata: false,
      canManageFields: true,
      canCreateRows: false,
      canUpdateRows: true,
      canDeleteRows: false,
    });
    expect(capability(DatasetType.join_requests)).toMatchObject({
      canUpdateMetadata: true,
      canManageFields: true,
      canCreateRows: false,
      canUpdateRows: false,
      canDeleteRows: false,
    });
  });

  it('makes archived and activity-registration Datasets read-only', () => {
    expect(Object.values(
      capability(DatasetType.standard, DatasetStatus.archived),
    ).every((value) => !value))
      .toBe(true);
    expect(Object.values(capability(DatasetType.activity_registrations)).every((value) => !value))
      .toBe(true);
  });

  it('rejects a different Workspace before reading', async () => {
    const service = new DatasetsService({} as never, {} as never, {} as never);
    await expect(service.list(2, actor)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Dataset row-window and relation option boundary', () => {
  it('uses count plus stable skip/take for an empty distant window', async () => {
    const prisma = {
      datasetRow: {
        count: vi.fn().mockResolvedValue(5_000),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const datasets = { get: vi.fn().mockResolvedValue(detail()) };
    const service = new DatasetRowsService(
      prisma as never,
      datasets as never,
      {} as never,
      {} as never,
    );
    const result = await service.queryWindow(1, 'dataset-1', {
      query: { filters: [], sorts: [], group: null },
      window: { offset: 4_950, limit: 50 },
    }, actor);

    expect(result).toMatchObject({ totalRowCount: 5_000, startIndex: 4_950, items: [] });
    expect(prisma.datasetRow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { id: 'asc' },
      skip: 4_950,
      take: 50,
    }));
  });

  it('rejects complex queries above the active-row ceiling', async () => {
    const prisma = { datasetRow: { count: vi.fn().mockResolvedValue(5_001) } };
    const service = new DatasetRowsService(
      prisma as never,
      { get: vi.fn().mockResolvedValue(detail()) } as never,
      {} as never,
      {} as never,
    );
    await expect(service.queryWindow(1, 'dataset-1', {
      query: {
        filters: [{
          id: 'filter', fieldId: field.id, operator: 'contains', value: 'A',
        }],
        sorts: [],
        group: null,
      },
      window: { offset: 0, limit: 50 },
    }, actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires target Dataset read access for relation options', async () => {
    const relationField: DatasetFieldDefinition = {
      ...field,
      id: 'field-relation',
      kind: 'relation',
      relationTargetDatasetId: 'dataset-target',
      relationCardinality: 'one',
    };
    const datasets = {
      get: vi.fn()
        .mockResolvedValueOnce(detail([relationField]))
        .mockRejectedValueOnce(new ForbiddenException()),
    };
    const service = new DatasetRowsService(
      {} as never,
      datasets as never,
      {} as never,
      {} as never,
    );
    await expect(service.relationOptions(
      1,
      'dataset-1',
      relationField.id,
      actor,
      { limit: 50, selectedIds: [] },
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses a configured label and stable row-ID fallback', async () => {
    const relationField: DatasetFieldDefinition = {
      ...field,
      id: 'field-relation',
      kind: 'relation',
      config: { labelFieldId: 'field-label' },
      relationTargetDatasetId: 'dataset-target',
      relationCardinality: 'one',
    };
    const labelField = { ...field, id: 'field-label', datasetId: 'dataset-target' };
    const target = detail([labelField]);
    target.dataset = { ...target.dataset, id: 'dataset-target' };
    const datasets = {
      get: vi.fn()
        .mockResolvedValueOnce(detail([relationField]))
        .mockResolvedValueOnce(target),
    };
    const prisma = {
      datasetRow: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'row-1', values: { 'field-label': 'Alice' } },
          { id: 'row-2', values: {} },
        ]),
      },
    };
    const service = new DatasetRowsService(
      prisma as never,
      datasets as never,
      {} as never,
      {} as never,
    );
    await expect(service.relationOptions(
      1,
      'dataset-1',
      relationField.id,
      actor,
      { limit: 1, selectedIds: ['row-2'] },
    )).resolves.toEqual({
      items: [{ label: 'Alice', value: 'row-1' }, { label: 'row-2', value: 'row-2' }],
      nextCursor: 'row-1',
    });
  });
});
