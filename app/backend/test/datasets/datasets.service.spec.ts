import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  DatasetCollaboratorRole,
  DatasetFieldDataType,
  DatasetFieldKind,
  DatasetStatus,
  DatasetType,
  MemberStatus,
} from '@prisma/client';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { AuthenticatedActor } from '@weave/types';

import { DatasetSchemaService } from '../../src/datasets/dataset-schema.service';
import { DatasetsService } from '../../src/datasets/datasets.service';

const actor: AuthenticatedActor = {
  userId: 'admin-1',
  workspaceId: 1,
  sessionId: 'session-1',
  permissions: ['dataset.manage_all'],
  isSystemAdmin: false,
  isWorkspaceAdmin: true,
};

function createService(prisma: object): DatasetsService {
  return new DatasetsService(
    prisma as never,
    { record: vi.fn() } as never,
    {} as never,
  );
}

describe('Dataset mutation invariants', () => {
  it('projects visible Dataset list rows without account-sensitive creator data', async () => {
    const createdAt = new Date('2026-08-08T00:00:00.000Z');
    const prisma = {
      dataset: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'dataset-1',
          workspaceId: 1,
          name: 'People',
          slug: 'people',
          description: null,
          type: DatasetType.standard,
          status: DatasetStatus.active,
          subjectMode: 'none',
          revision: 1,
          createdAt,
          updatedAt: createdAt,
          createdBy: {
            id: 'creator-1',
            name: 'Creator',
            nickname: null,
            username: 'creator',
            avatarUrl: null,
            email: 'must-not-leak@example.com',
          },
          collaborators: [{
            workspaceMemberId: 'member-1',
            role: DatasetCollaboratorRole.owner,
          }],
        }]),
      },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({ id: 'member-1' }),
      },
    };

    const response = await createService(prisma).list(1, actor);

    expect(response).toMatchObject({
      canCreate: true,
      items: [{
        id: 'dataset-1',
        creator: { id: 'creator-1', displayName: 'Creator', avatarUrl: null },
      }],
    });
    expect(response.items[0]?.creator).not.toHaveProperty('email');
    expect(prisma.dataset.findMany.mock.calls[0]?.[0]?.select).not.toHaveProperty('fields');
  });

  it('projects detail with active ordered fields and a safe creator', async () => {
    const timestamp = new Date('2026-08-08T00:00:00.000Z');
    const dataset = {
      id: 'dataset-1',
      workspaceId: 1,
      name: 'People',
      slug: 'people',
      description: null,
      type: DatasetType.standard,
      status: DatasetStatus.active,
      subjectMode: 'none',
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: {
        id: 'creator-1',
        name: 'Creator',
        nickname: null,
        username: 'creator',
        avatarUrl: null,
        email: 'must-not-leak@example.com',
      },
      collaborators: [],
      fields: [{
        id: 'field-1',
        datasetId: 'dataset-1',
        key: 'name',
        name: 'Name',
        description: null,
        dataType: DatasetFieldDataType.string,
        kind: DatasetFieldKind.text,
        valueSchema: { type: 'string' },
        config: {},
        required: true,
        isSystemManaged: false,
        systemKey: null,
        relationTargetDatasetId: null,
        relationCardinality: null,
        position: 0,
        revision: 1,
        archivedAt: null,
      }],
    };
    const prisma = {
      dataset: {
        findUnique: vi.fn().mockResolvedValue(dataset),
        findUniqueOrThrow: vi.fn().mockResolvedValue(dataset),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-1' }) },
    };

    const response = await createService(prisma).get(1, 'dataset-1', actor);

    expect(response.creator).toEqual({
      id: 'creator-1',
      displayName: 'Creator',
      avatarUrl: null,
    });
    expect(response.fields).toHaveLength(1);
    expect(prisma.dataset.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        fields: expect.objectContaining({
          where: { archivedAt: null },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
        }),
      }),
    }));
  });

  it('protects the final owner of an active Dataset', async () => {
    const tx = {
      dataset: { findUniqueOrThrow: vi.fn().mockResolvedValue({ status: DatasetStatus.active }) },
      datasetCollaborator: {
        count: vi.fn().mockResolvedValue(0),
        delete: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ role: DatasetCollaboratorRole.owner }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      dataset: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'dataset-1',
          workspaceId: 1,
          type: DatasetType.standard,
          status: DatasetStatus.active,
        }),
      },
    };

    await expect(createService(prisma).removeCollaborator(
      1,
      'dataset-1',
      'member-1',
      actor,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(tx.datasetCollaborator.delete).not.toHaveBeenCalled();
  });

  it('rejects a collaborator from another Workspace', async () => {
    const prisma = {
      dataset: { findUnique: vi.fn().mockResolvedValue({ id: 'dataset-1', workspaceId: 1 }) },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'member-2',
          workspaceId: 2,
          status: MemberStatus.active,
        }),
      },
    };

    await expect(createService(prisma).addCollaborator(1, 'dataset-1', {
      workspaceMemberId: 'member-2',
      role: DatasetCollaboratorRole.maintainer,
    }, actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects stale Dataset metadata revisions before creating history', async () => {
    const tx = {
      dataset: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      dataset: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'dataset-1',
          workspaceId: 1,
          type: DatasetType.standard,
          status: DatasetStatus.active,
        }),
      },
    };

    await expect(createService(prisma).update(1, 'dataset-1', {
      expectedRevision: 1,
      name: 'New name',
    }, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('normalizes inserted field positions and records one transactional audit', async () => {
    const timestamp = new Date('2026-08-08T00:00:00.000Z');
    const createdField = {
      id: 'field-new',
      workspaceId: 1,
      datasetId: 'dataset-1',
      key: 'new',
      name: 'New',
      description: null,
      dataType: DatasetFieldDataType.string,
      kind: 'text',
      valueSchema: { type: 'string' },
      config: {},
      required: false,
      isSystemManaged: false,
      systemKey: null,
      relationTargetDatasetId: null,
      relationCardinality: null,
      position: 1,
      revision: 1,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const tx = {
      dataset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      datasetField: {
        findMany: vi.fn().mockResolvedValue([{ id: 'field-a' }, { id: 'field-b' }]),
        create: vi.fn().mockResolvedValue(createdField),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      dataset: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'dataset-1',
          workspaceId: 1,
          type: DatasetType.standard,
          status: DatasetStatus.active,
        }),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new DatasetsService(
      prisma as never,
      audit as never,
      { assertFieldSchema: vi.fn().mockReturnValue({ type: 'string' }) } as never,
    );
    vi.spyOn(service, 'createDefinitionVersion').mockResolvedValue(undefined);

    await expect(service.createField(1, 'dataset-1', {
      expectedDatasetRevision: 3,
      key: 'new',
      name: 'New',
      description: null,
      kind: DatasetFieldKind.text,
      valueSchema: { type: 'string' },
      config: {},
      required: false,
      relationTargetDatasetId: null,
      relationCardinality: null,
      position: 1,
    }, actor)).resolves.toMatchObject({ datasetRevision: 4 });
    expect(tx.datasetField.update.mock.calls.map(([input]) => input)).toEqual([
      { where: { id: 'field-a' }, data: { position: 0 } },
      { where: { id: 'field-new' }, data: { position: 1 } },
      { where: { id: 'field-b' }, data: { position: 2 } },
    ]);
    expect(audit.record).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dataset.field.create',
      metadata: { datasetId: 'dataset-1', kind: DatasetFieldKind.text },
    }), tx);
  });

  it('converts single_select to multi_select when every active row is valid', async () => {
    const existingField = {
      id: 'field-1',
      workspaceId: 1,
      datasetId: 'dataset-1',
      key: 'status',
      name: 'Status',
      description: null,
      dataType: DatasetFieldDataType.string_array,
      kind: DatasetFieldKind.single_select,
      valueSchema: { type: 'array', items: { type: 'string' }, maxItems: 1 },
      config: { options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] },
      required: false,
      isSystemManaged: false,
      systemKey: null,
      relationTargetDatasetId: null,
      relationCardinality: null,
      position: 0,
      revision: 1,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updatedField = {
      ...existingField,
      kind: DatasetFieldKind.multi_select,
      revision: 2,
      valueSchema: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    };
    const tx = {
      dataset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      datasetRow: {
        findMany: vi.fn().mockResolvedValue([{ id: 'row-ok', values: { 'field-1': ['one'] } }]),
      },
      datasetField: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
        findUniqueOrThrow: vi.fn().mockResolvedValue(updatedField),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      dataset: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'dataset-1',
          workspaceId: 1,
          type: DatasetType.standard,
          status: DatasetStatus.active,
        }),
      },
      datasetField: { findUnique: vi.fn().mockResolvedValue(existingField) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DatasetsService(
      prisma as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
      new DatasetSchemaService(),
    );
    vi.spyOn(service, 'createDefinitionVersion').mockResolvedValue(undefined);

    await expect(service.updateField(1, 'dataset-1', 'field-1', {
      expectedDatasetRevision: 1,
      expectedFieldRevision: 1,
      kind: DatasetFieldKind.multi_select,
    }, actor)).resolves.toMatchObject({ datasetRevision: 2 });
    expect(tx.datasetField.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: DatasetFieldKind.multi_select }),
    }));
  });

  it('rejects multi_select to single_select when a row has more than one value', async () => {
    const existingField = {
      id: 'field-1',
      workspaceId: 1,
      datasetId: 'dataset-1',
      key: 'status',
      name: 'Status',
      description: null,
      dataType: DatasetFieldDataType.string_array,
      kind: DatasetFieldKind.multi_select,
      valueSchema: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      config: { options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] },
      required: false,
      isSystemManaged: false,
      systemKey: null,
      relationTargetDatasetId: null,
      relationCardinality: null,
      position: 0,
      revision: 1,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = {
      dataset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      datasetRow: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'row-bad', values: { 'field-1': ['one', 'two'] } },
        ]),
      },
      datasetField: {
        updateMany: vi.fn(),
        findMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    };
    const prisma = {
      dataset: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'dataset-1',
          workspaceId: 1,
          type: DatasetType.standard,
          status: DatasetStatus.active,
        }),
      },
      datasetField: { findUnique: vi.fn().mockResolvedValue(existingField) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new DatasetsService(
      prisma as never,
      { record: vi.fn() } as never,
      new DatasetSchemaService(),
    );

    const error = await service.updateField(1, 'dataset-1', 'field-1', {
      expectedDatasetRevision: 1,
      expectedFieldRevision: 1,
      kind: DatasetFieldKind.single_select,
    }, actor).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      message: 'Dataset field kind conversion rejected because existing rows are invalid',
      invalidRowIds: ['row-bad'],
    });
    expect(tx.datasetField.updateMany).not.toHaveBeenCalled();
  });
});
