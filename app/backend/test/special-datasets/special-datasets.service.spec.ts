import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  ActivityStatus,
  DatasetStatus,
  DatasetType,
  JoinRequestStatus,
} from '@prisma/client';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { AuthenticatedActor } from '@weave/types';

import { ActivitiesService } from '../../src/special-datasets/activities.service';
import { JoinRequestsService } from '../../src/special-datasets/join-requests.service';

const actor: AuthenticatedActor = {
  userId: 'user-1',
  workspaceId: 1,
  sessionId: 'session-1',
  permissions: [],
  isSystemAdmin: false,
  isWorkspaceAdmin: false,
};

const reviewerActor: AuthenticatedActor = {
  ...actor,
  permissions: ['join_request.review'],
};

describe('special Dataset invariants', () => {
  it('validates Join Request relations through the write transaction without a Form filter', async () => {
    const relationField = {
      id: 'relation-field',
      systemKey: null,
      relationTargetDatasetId: 'target-dataset',
    };
    const fields = [
      { id: 'name-field', systemKey: 'applicant_name', relationTargetDatasetId: null },
      { id: 'email-field', systemKey: 'applicant_email', relationTargetDatasetId: null },
      relationField,
    ];
    const relations = new Map([['relation-field', ['target-row']]]);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      dataset: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'dataset-1',
          status: DatasetStatus.active,
          type: DatasetType.join_requests,
        }),
      },
      datasetField: { findMany: vi.fn().mockResolvedValue(fields) },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({
          memberType: { slug: 'guest' },
          user: { email: 'guest@example.com', name: 'Guest' },
        }),
      },
      datasetRowSubject: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: vi.fn(),
      },
      datasetRow: {
        create: vi.fn().mockResolvedValue({ id: 'row-1', revision: 1 }),
      },
      joinRequest: {
        create: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ rowId: 'row-1' }),
      },
      datasetRelation: { createMany: vi.fn() },
      datasetRowVersion: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const schemas = {
      validateRow: vi.fn().mockReturnValue({ values: {}, relations }),
    };
    const audit = { record: vi.fn() };
    const relationValidation = { validate: vi.fn().mockResolvedValue([]) };
    const service = new JoinRequestsService(
      prisma as never,
      schemas as never,
      {} as never,
      audit as never,
      relationValidation as never,
    );

    await service.submit(1, 'dataset-1', {
      values: {},
      relations: { 'relation-field': ['target-row'] },
    }, actor);

    expect(relationValidation.validate).toHaveBeenCalledWith(
      tx,
      1,
      fields,
      relations,
      { updateRowIds: [] },
    );
    expect(tx.datasetRelation.createMany).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'join_request.submit',
    }), tx);
  });

  it('allows Join Requests only for guest members', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      dataset: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'dataset-1',
          status: DatasetStatus.active,
          type: DatasetType.join_requests,
        }),
      },
      datasetField: { findMany: vi.fn().mockResolvedValue([]) },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({
          memberType: { slug: 'member' },
          user: { email: 'member@example.com', name: 'Member' },
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new JoinRequestsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.submit(1, 'dataset-1', {
      values: {},
      relations: {},
    }, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires reviewer authorization before opening a decision transaction', async () => {
    const transaction = vi.fn();
    const service = new JoinRequestsService(
      { $transaction: transaction } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.reject(1, 'row-1', { expectedRevision: 1 }, actor))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.approve(1, 'row-1', {
      expectedRevision: 1,
      memberTypeId: 'member-type-1',
    }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a concurrent Join Request decision with stale revision', async () => {
    const tx = {
      joinRequest: {
        findUnique: vi.fn().mockResolvedValue({
          workspaceId: 1,
          status: JoinRequestStatus.submitted,
          row: { subject: { userId: 'user-1' }, sourceRelations: [] },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new JoinRequestsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.reject(1, 'row-1', {
      expectedRevision: 1,
    }, reviewerActor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows Workspace administrators to enter the decision workflow', async () => {
    const tx = {
      joinRequest: {
        findUnique: vi.fn().mockResolvedValue({
          workspaceId: 1,
          status: JoinRequestStatus.submitted,
          row: { subject: { userId: 'user-1' }, sourceRelations: [] },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new JoinRequestsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.reject(1, 'row-1', {
      expectedRevision: 1,
    }, { ...actor, isWorkspaceAdmin: true })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not bind registrations while an Activity is closed', async () => {
    const service = new ActivitiesService({} as never, {} as never, {} as never);

    await expect(service.bindRegistration({} as never, {
      id: 'activity-1',
      registrationDatasetId: 'dataset-1',
      status: ActivityStatus.closed,
      workspaceId: 1,
    }, 'row-1', null)).rejects.toBeInstanceOf(ConflictException);
  });
});
