import { DatasetCollaboratorRole, DatasetType } from '@prisma/client';
import {
  describe, expect, it, vi,
} from 'vitest';

import type {
  AuthenticatedActor,
  DatasetDetailResponse,
  DatasetFieldDefinition,
} from '@weave/types';

import { DatasetRowsService } from '../../src/datasets/dataset-rows.service';
import { DatasetsService } from '../../src/datasets/datasets.service';

const actor: AuthenticatedActor = {
  userId: 'user-1',
  workspaceId: 1,
  sessionId: 'session-1',
  permissions: ['dataset.manage_all'],
  isSystemAdmin: false,
  isWorkspaceAdmin: false,
};

function field(
  id: string,
  kind: DatasetFieldDefinition['kind'],
  position: number,
): DatasetFieldDefinition {
  return {
    id,
    datasetId: 'dataset-1',
    key: id,
    name: id,
    description: null,
    dataType: kind === 'number' ? 'number' : 'string',
    kind,
    valueSchema: {},
    config: {},
    required: false,
    isSystemManaged: false,
    systemKey: null,
    relationTargetDatasetId: null,
    relationCardinality: null,
    position,
    revision: 1,
    archivedAt: null,
  };
}

const groupField = field('field-city', 'text', 0);
const scoreField = field('field-score', 'number', 1);

function detail(): DatasetDetailResponse {
  const datasets = new DatasetsService({} as never, {} as never, {} as never);
  const capabilitiesFor = (datasets as unknown as {
    capabilitiesFor: (
      dataset: { status: 'active'; type: DatasetType },
      currentActor: AuthenticatedActor,
      role: DatasetCollaboratorRole,
    ) => DatasetDetailResponse['capabilities'];
  }).capabilitiesFor.bind(datasets);
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
      revision: 1,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
    fields: [groupField, scoreField],
    creator: { id: actor.userId, displayName: 'User', avatarUrl: null },
    capabilities: capabilitiesFor(
      { status: 'active', type: DatasetType.standard },
      actor,
      DatasetCollaboratorRole.owner,
    ),
  };
}

function row(id: string, city: string, score: number) {
  const timestamp = new Date('2026-08-08T00:00:00.000Z');
  return {
    id,
    datasetId: 'dataset-1',
    values: { [groupField.id]: city, [scoreField.id]: score },
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    sourceRelations: [],
  };
}

describe('Dataset complex row windows', () => {
  it('returns a complete group directory with aggregates', async () => {
    const prisma = {
      datasetRow: {
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue([
          row('row-1', 'Shanghai', 2),
          row('row-2', 'Beijing', 4),
          row('row-3', 'Shanghai', 6),
        ]),
      },
    };
    const service = new DatasetRowsService(
      prisma as never,
      { get: vi.fn().mockResolvedValue(detail()) } as never,
      {} as never,
      {} as never,
    );

    const response = await service.queryWindow(1, 'dataset-1', {
      query: {
        filters: [],
        sorts: [],
        group: {
          fieldId: groupField.id,
          aggregates: [{ id: 'score-sum', fieldId: scoreField.id, operation: 'sum' }],
        },
      },
      window: { offset: 1, limit: 1 },
      includeGroupDirectory: true,
    }, actor);

    expect(response).toMatchObject({ totalRowCount: 3, startIndex: 1 });
    expect(response.items).toHaveLength(1);
    expect(response.groups).toEqual([
      expect.objectContaining({ groupKey: 'Beijing', rowCount: 1, aggregates: { 'score-sum': 4 } }),
      expect.objectContaining({ groupKey: 'Shanghai', rowCount: 2, aggregates: { 'score-sum': 8 } }),
    ]);
  });
});
