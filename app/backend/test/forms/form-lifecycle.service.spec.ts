import { ConflictException } from '@nestjs/common';
import {
  DatasetStatus,
  DatasetSubjectMode,
  DatasetType,
  FormStatus,
} from '@prisma/client';
import type { Sql } from '@prisma/client/runtime/library';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { AuthenticatedActor } from '@weave/types';

import { FormsService } from '../../src/forms/forms.service';

const actor: AuthenticatedActor = {
  userId: 'admin-1',
  workspaceId: 1,
  sessionId: 'session-1',
  permissions: [],
  isSystemAdmin: false,
  isWorkspaceAdmin: true,
};

function lifecycleHarness(status: FormStatus, revision = 3) {
  const events: string[] = [];
  const form = {
    id: 'form-1',
    workspaceId: 1,
    datasetId: 'dataset-1',
    slug: 'registration',
    status,
    activeVersionId: 'version-1',
    revision,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  };
  const dataset = {
    id: 'dataset-1',
    workspaceId: 1,
    status: DatasetStatus.active,
    subjectMode: DatasetSubjectMode.none,
    type: DatasetType.standard,
  };
  const tx = {
    $queryRaw: vi.fn((query: Sql) => {
      events.push(query.strings.join('').includes('Dataset"') ? 'dataset-lock' : 'form-lock');
      return [];
    }),
    dataset: {
      findUnique: vi.fn().mockImplementation(() => {
        events.push('dataset-read');
        return dataset;
      }),
    },
    form: {
      findUnique: vi.fn().mockImplementation(() => {
        events.push('form-read');
        return form;
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(() => ({
        ...form,
        revision: revision + 1,
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    form: { findUnique: vi.fn().mockResolvedValue(form) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const audit = { record: vi.fn() };
  const redis = { del: vi.fn() };
  const service = new FormsService(
    prisma as never,
    { assertCanManage: vi.fn().mockResolvedValue(dataset) } as never,
    {} as never,
    audit as never,
    redis as never,
  );
  return {
    audit, dataset, events, form, prisma, redis, service, tx,
  };
}

type LifecycleOperation = 'archive' | 'close' | 'reopen' | 'restore';

function runLifecycleOperation(
  service: FormsService,
  operation: LifecycleOperation,
  expectedRevision = 3,
) {
  return service[operation](1, 'form-1', expectedRevision, actor);
}

describe('Form lifecycle transitions', () => {
  it.each([
    [FormStatus.active, 'close', FormStatus.closed],
    [FormStatus.closed, 'reopen', FormStatus.active],
    [FormStatus.active, 'archive', FormStatus.archived],
    [FormStatus.closed, 'archive', FormStatus.archived],
    [FormStatus.archived, 'restore', FormStatus.active],
  ] as const)(
    'allows %s to %s as %s with one transactional audit',
    async (previousStatus, operation, status) => {
      const harness = lifecycleHarness(previousStatus);
      harness.tx.form.findUniqueOrThrow.mockResolvedValue({
        ...harness.form,
        status,
        revision: 4,
      });

      const updated = await runLifecycleOperation(harness.service, operation);

      expect(updated).toEqual(expect.objectContaining({ status, revision: 4 }));
      expect(harness.events).toEqual([
        'dataset-lock',
        'form-lock',
        'dataset-read',
        'form-read',
      ]);
      expect(harness.tx.form.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'form-1',
          workspaceId: 1,
          revision: 3,
          status: previousStatus,
        },
        data: { status, revision: { increment: 1 } },
      });
      expect(harness.audit.record).toHaveBeenCalledTimes(1);
      expect(harness.audit.record).toHaveBeenCalledWith({
        action: 'form.status.update',
        actorType: 'user',
        actorUserId: actor.userId,
        resourceType: 'form',
        resourceId: 'form-1',
        result: 'success',
        workspaceId: 1,
        metadata: { previousStatus, status },
      }, harness.tx);
      expect(harness.redis.del).toHaveBeenCalledTimes(status === FormStatus.archived ? 1 : 0);
    },
  );

  it.each([
    [FormStatus.active, 'reopen'],
    [FormStatus.active, 'restore'],
    [FormStatus.closed, 'close'],
    [FormStatus.closed, 'restore'],
    [FormStatus.archived, 'close'],
    [FormStatus.archived, 'reopen'],
    [FormStatus.archived, 'archive'],
  ] as const)(
    'rejects %s through %s without mutation or audit',
    async (previousStatus, operation) => {
      const harness = lifecycleHarness(previousStatus);

      await expect(
        runLifecycleOperation(harness.service, operation),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(harness.tx.form.updateMany).not.toHaveBeenCalled();
      expect(harness.audit.record).not.toHaveBeenCalled();
    },
  );

  it('rejects a stale revision after the aggregate locks without an audit', async () => {
    const harness = lifecycleHarness(FormStatus.active, 4);

    await expect(
      harness.service.close(1, 'form-1', 3, actor),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.events.slice(0, 2)).toEqual(['dataset-lock', 'form-lock']);
    expect(harness.tx.form.updateMany).not.toHaveBeenCalled();
    expect(harness.audit.record).not.toHaveBeenCalled();
  });

  it('keeps publication active-only for a closed Form', async () => {
    const harness = lifecycleHarness(FormStatus.closed);

    await expect(
      harness.service.publish(1, 'form-1', 3, actor, 'lock-token'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.audit.record).not.toHaveBeenCalled();
  });
});
