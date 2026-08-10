/* eslint-disable import/no-extraneous-dependencies --
 * Integration tests use the package test runner.
 */
import { randomUUID } from 'node:crypto';

import {
  DatasetFieldKind,
  DatasetStatus,
  DatasetType,
  FormStatus,
  PrismaClient,
  RelationCardinality,
} from '@prisma/client';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  lockDatasetParent,
  lockDatasetRows,
  lockFormParent,
} from '../../src/common/aggregate-locks';
import { RelationValidationService } from '../../src/common/relation-validation.service';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

interface Fixture {
  choiceFieldId: string;
  formId: string;
  relationFieldId: string;
  sourceDatasetId: string;
  sourceRowId: string;
  targetDatasetId: string;
  targetRowId: string;
  userId: string;
  workspaceId: number;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function expectBlocked(promise: Promise<unknown>): Promise<void> {
  let settled = false;
  promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  await new Promise((resolve) => { setTimeout(resolve, 100); });
  expect(settled).toBe(false);
}

describe.sequential('database-backed Form/Dataset lock barriers', () => {
  const writerClient = new PrismaClient();
  const competingClient = new PrismaClient();
  const observerClient = new PrismaClient();

  beforeAll(async () => {
    await Promise.all([
      writerClient.$connect(),
      competingClient.$connect(),
      observerClient.$connect(),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      writerClient.$disconnect(),
      competingClient.$disconnect(),
      observerClient.$disconnect(),
    ]);
  });

  async function createFixture(): Promise<Fixture> {
    const suffix = randomUUID();
    const user = await observerClient.user.create({
      data: {
        email: `form-lock-${suffix}@example.test`,
        username: `form-lock-${suffix}`,
        name: 'Form lock test',
        nickname: 'Form lock test',
      },
    });
    const workspace = await observerClient.workspace.create({
      data: {
        name: `Form lock ${suffix}`,
        slug: `form-lock-${suffix}`,
        ownerUserId: user.id,
      },
    });
    const [sourceDataset, targetDataset] = await Promise.all([
      observerClient.dataset.create({
        data: {
          workspaceId: workspace.id,
          name: 'Source',
          slug: `source-${suffix}`,
          type: DatasetType.standard,
          createdByUserId: user.id,
        },
      }),
      observerClient.dataset.create({
        data: {
          workspaceId: workspace.id,
          name: 'Target',
          slug: `target-${suffix}`,
          type: DatasetType.standard,
          createdByUserId: user.id,
        },
      }),
    ]);
    const relationField = await observerClient.datasetField.create({
      data: {
        workspaceId: workspace.id,
        datasetId: sourceDataset.id,
        key: 'relation',
        name: 'Relation',
        kind: DatasetFieldKind.relation,
        valueSchema: { type: 'string' },
        relationTargetDatasetId: targetDataset.id,
        relationCardinality: RelationCardinality.one,
        position: 0,
      },
    });
    const choiceField = await observerClient.datasetField.create({
      data: {
        workspaceId: workspace.id,
        datasetId: sourceDataset.id,
        key: 'choice',
        name: 'Choice',
        kind: DatasetFieldKind.single_select,
        valueSchema: { type: 'string' },
        config: { options: [{ value: 'kept', label: 'Kept' }] },
        position: 1,
      },
    });
    const [sourceRow, targetRow] = await Promise.all([
      observerClient.datasetRow.create({
        data: { workspaceId: workspace.id, datasetId: sourceDataset.id, values: {} },
      }),
      observerClient.datasetRow.create({
        data: { workspaceId: workspace.id, datasetId: targetDataset.id, values: {} },
      }),
    ]);
    const form = await observerClient.form.create({
      data: {
        workspaceId: workspace.id,
        datasetId: sourceDataset.id,
        slug: `form-${suffix}`,
        createdByUserId: user.id,
      },
    });
    return {
      choiceFieldId: choiceField.id,
      formId: form.id,
      relationFieldId: relationField.id,
      sourceDatasetId: sourceDataset.id,
      sourceRowId: sourceRow.id,
      targetDatasetId: targetDataset.id,
      targetRowId: targetRow.id,
      userId: user.id,
      workspaceId: workspace.id,
    };
  }

  async function cleanup(fixture: Fixture): Promise<void> {
    await observerClient.form.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await observerClient.datasetRelation.deleteMany({
      where: { workspaceId: fixture.workspaceId },
    });
    await observerClient.datasetRow.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await observerClient.datasetField.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await observerClient.dataset.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await observerClient.workspace.delete({ where: { id: fixture.workspaceId } });
    await observerClient.user.delete({ where: { id: fixture.userId } });
  }

  it('linearizes relation-writer-first before target delete and makes delete reject', async () => {
    const fixture = await createFixture();
    const writerLocked = deferred();
    const releaseWriter = deferred();
    try {
      const writer = writerClient.$transaction(async (tx) => {
        await lockDatasetParent(tx, fixture.sourceDatasetId, 'share');
        await new RelationValidationService().validate(
          tx,
          fixture.workspaceId,
          [{ id: fixture.relationFieldId, relationTargetDatasetId: fixture.targetDatasetId }],
          new Map([[fixture.relationFieldId, [fixture.targetRowId]]]),
        );
        writerLocked.resolve();
        await releaseWriter.promise;
        await tx.datasetRelation.create({
          data: {
            workspaceId: fixture.workspaceId,
            sourceDatasetId: fixture.sourceDatasetId,
            sourceRowId: fixture.sourceRowId,
            fieldId: fixture.relationFieldId,
            targetDatasetId: fixture.targetDatasetId,
            targetRowId: fixture.targetRowId,
          },
        });
      });
      await writerLocked.promise;

      const deletion = competingClient.$transaction(async (tx) => {
        await lockDatasetParent(tx, fixture.targetDatasetId, 'share');
        await lockDatasetRows(tx, [fixture.targetRowId], 'update');
        const incoming = await tx.datasetRelation.count({
          where: { targetRowId: fixture.targetRowId },
        });
        if (incoming > 0) throw new Error('referenced');
        await tx.datasetRow.update({
          where: { id: fixture.targetRowId },
          data: { deletedAt: new Date() },
        });
      });
      await expectBlocked(deletion);
      releaseWriter.resolve();
      await writer;
      await expect(deletion).rejects.toThrow('referenced');

      expect(await observerClient.datasetRelation.count({
        where: { targetRowId: fixture.targetRowId },
      })).toBe(1);
      expect((await observerClient.datasetRow.findUniqueOrThrow({
        where: { id: fixture.targetRowId },
      })).deletedAt).toBeNull();
    } finally {
      releaseWriter.resolve();
      await cleanup(fixture);
    }
  });

  it('linearizes target-delete-first before relation write and makes the writer reject', async () => {
    const fixture = await createFixture();
    const deleteLocked = deferred();
    const releaseDelete = deferred();
    try {
      const deletion = writerClient.$transaction(async (tx) => {
        await lockDatasetParent(tx, fixture.targetDatasetId, 'share');
        await lockDatasetRows(tx, [fixture.targetRowId], 'update');
        deleteLocked.resolve();
        await releaseDelete.promise;
        const incoming = await tx.datasetRelation.count({
          where: { targetRowId: fixture.targetRowId },
        });
        if (incoming > 0) throw new Error('referenced');
        await tx.datasetRow.update({
          where: { id: fixture.targetRowId },
          data: { deletedAt: new Date() },
        });
      });
      await deleteLocked.promise;

      const writer = competingClient.$transaction(async (tx) => {
        await lockDatasetParent(tx, fixture.sourceDatasetId, 'share');
        await new RelationValidationService().validate(
          tx,
          fixture.workspaceId,
          [{ id: fixture.relationFieldId, relationTargetDatasetId: fixture.targetDatasetId }],
          new Map([[fixture.relationFieldId, [fixture.targetRowId]]]),
        );
        await tx.datasetRelation.create({
          data: {
            workspaceId: fixture.workspaceId,
            sourceDatasetId: fixture.sourceDatasetId,
            sourceRowId: fixture.sourceRowId,
            fieldId: fixture.relationFieldId,
            targetDatasetId: fixture.targetDatasetId,
            targetRowId: fixture.targetRowId,
          },
        });
      });
      await expectBlocked(writer);
      releaseDelete.resolve();
      await deletion;
      await expect(writer).rejects.toThrow('Invalid relation target');

      expect(await observerClient.datasetRelation.count({
        where: { targetRowId: fixture.targetRowId },
      })).toBe(0);
      expect((await observerClient.datasetRow.findUniqueOrThrow({
        where: { id: fixture.targetRowId },
      })).deletedAt).not.toBeNull();
    } finally {
      releaseDelete.resolve();
      await cleanup(fixture);
    }
  });

  type DefinitionMutation = 'dataset-archive' | 'field-archive' | 'option-delete';

  async function mutateDefinition(fixture: Fixture, mutation: DefinitionMutation): Promise<void> {
    await writerClient.$transaction(async (tx) => {
      await lockDatasetParent(tx, fixture.sourceDatasetId, 'update');
      if (mutation === 'dataset-archive') {
        await tx.dataset.update({
          where: { id: fixture.sourceDatasetId },
          data: {
            status: DatasetStatus.archived,
            archivedAt: new Date(),
            revision: { increment: 1 },
          },
        });
      } else if (mutation === 'field-archive') {
        await tx.datasetField.update({
          where: { id: fixture.choiceFieldId },
          data: { archivedAt: new Date(), revision: { increment: 1 } },
        });
      } else {
        await tx.datasetField.update({
          where: { id: fixture.choiceFieldId },
          data: { config: { options: [] }, revision: { increment: 1 } },
        });
      }
    });
  }

  async function guardedSubmission(
    client: PrismaClient,
    fixture: Fixture,
    ready?: Deferred,
    release?: Deferred,
  ): Promise<void> {
    await client.$transaction(async (tx) => {
      await lockDatasetParent(tx, fixture.sourceDatasetId, 'share');
      await lockFormParent(tx, fixture.formId, 'share');
      const [dataset, form, field] = await Promise.all([
        tx.dataset.findUniqueOrThrow({ where: { id: fixture.sourceDatasetId } }),
        tx.form.findUniqueOrThrow({ where: { id: fixture.formId } }),
        tx.datasetField.findUniqueOrThrow({ where: { id: fixture.choiceFieldId } }),
      ]);
      if (dataset.status !== DatasetStatus.active || form.status !== FormStatus.active) {
        throw new Error('inactive');
      }
      const { options } = field.config as { options?: Array<{ value: string }> };
      if (field.archivedAt || !options?.some((option) => option.value === 'kept')) {
        throw new Error('definition changed');
      }
      ready?.resolve();
      if (release) await release.promise;
      await tx.datasetRow.create({
        data: {
          workspaceId: fixture.workspaceId,
          datasetId: fixture.sourceDatasetId,
          values: { [fixture.choiceFieldId]: 'kept' },
        },
      });
    });
  }

  it.each<DefinitionMutation>([
    'option-delete',
    'field-archive',
    'dataset-archive',
  ])('makes a submission started after %s observe the new definition and reject', async (mutation) => {
    const fixture = await createFixture();
    try {
      await mutateDefinition(fixture, mutation);
      await expect(guardedSubmission(competingClient, fixture)).rejects.toThrow();
      expect(await observerClient.datasetRow.count({
        where: {
          datasetId: fixture.sourceDatasetId,
          id: { not: fixture.sourceRowId },
        },
      })).toBe(0);
    } finally {
      await cleanup(fixture);
    }
  });

  it.each<DefinitionMutation>([
    'option-delete',
    'field-archive',
    'dataset-archive',
  ])('allows a submission already holding parent locks to precede %s safely', async (mutation) => {
    const fixture = await createFixture();
    const submissionLocked = deferred();
    const releaseSubmission = deferred();
    try {
      const submission = guardedSubmission(
        competingClient,
        fixture,
        submissionLocked,
        releaseSubmission,
      );
      await submissionLocked.promise;
      const definitionWrite = mutateDefinition(fixture, mutation);
      await expectBlocked(definitionWrite);
      releaseSubmission.resolve();
      await submission;
      await definitionWrite;
      expect(await observerClient.datasetRow.count({
        where: {
          datasetId: fixture.sourceDatasetId,
          id: { not: fixture.sourceRowId },
        },
      })).toBe(1);
    } finally {
      releaseSubmission.resolve();
      await cleanup(fixture);
    }
  });

  it('makes close-before-submission reject after the Form lock is released', async () => {
    const fixture = await createFixture();
    const closeLocked = deferred();
    const releaseClose = deferred();
    try {
      const close = writerClient.$transaction(async (tx) => {
        await lockDatasetParent(tx, fixture.sourceDatasetId, 'share');
        await lockFormParent(tx, fixture.formId, 'update');
        await tx.form.update({
          where: { id: fixture.formId },
          data: { status: FormStatus.closed, revision: { increment: 1 } },
        });
        closeLocked.resolve();
        await releaseClose.promise;
      });
      await closeLocked.promise;
      const submission = guardedSubmission(competingClient, fixture);
      await expectBlocked(submission);
      releaseClose.resolve();
      await close;
      await expect(submission).rejects.toThrow('inactive');
    } finally {
      releaseClose.resolve();
      await cleanup(fixture);
    }
  });

  it('allows submission-before-close to commit before the Form becomes closed', async () => {
    const fixture = await createFixture();
    const submissionLocked = deferred();
    const releaseSubmission = deferred();
    try {
      const submission = guardedSubmission(
        competingClient,
        fixture,
        submissionLocked,
        releaseSubmission,
      );
      await submissionLocked.promise;
      const close = writerClient.$transaction(async (tx) => {
        await lockDatasetParent(tx, fixture.sourceDatasetId, 'share');
        await lockFormParent(tx, fixture.formId, 'update');
        await tx.form.update({
          where: { id: fixture.formId },
          data: { status: FormStatus.closed, revision: { increment: 1 } },
        });
      });
      await expectBlocked(close);
      releaseSubmission.resolve();
      await submission;
      await close;
      expect((await observerClient.form.findUniqueOrThrow({
        where: { id: fixture.formId },
      })).status).toBe(FormStatus.closed);
    } finally {
      releaseSubmission.resolve();
      await cleanup(fixture);
    }
  });

  it('serializes capture draft, publish and submission without a reverse lock edge', async () => {
    const fixture = await createFixture();
    const draftLocked = deferred();
    const releaseDraft = deferred();
    try {
      const draft = writerClient.$transaction(async (tx) => {
        await lockDatasetParent(tx, fixture.sourceDatasetId, 'update');
        await lockFormParent(tx, fixture.formId, 'update');
        await tx.dataset.update({
          where: { id: fixture.sourceDatasetId },
          data: { revision: { increment: 1 } },
        });
        await tx.form.update({
          where: { id: fixture.formId },
          data: { revision: { increment: 1 } },
        });
        draftLocked.resolve();
        await releaseDraft.promise;
      });
      await draftLocked.promise;

      const publish = competingClient.$transaction(async (tx) => {
        await lockDatasetParent(tx, fixture.sourceDatasetId, 'share');
        await lockFormParent(tx, fixture.formId, 'update');
        const dataset = await tx.dataset.findUniqueOrThrow({
          where: { id: fixture.sourceDatasetId },
        });
        if (dataset.revision !== 2) throw new Error('stale Dataset definition published');
        await tx.form.update({
          where: { id: fixture.formId },
          data: { revision: { increment: 1 } },
        });
      });
      const submission = observerClient.$transaction(async (tx) => {
        await lockDatasetParent(tx, fixture.sourceDatasetId, 'share');
        await lockFormParent(tx, fixture.formId, 'share');
        const [dataset, form] = await Promise.all([
          tx.dataset.findUniqueOrThrow({ where: { id: fixture.sourceDatasetId } }),
          tx.form.findUniqueOrThrow({ where: { id: fixture.formId } }),
        ]);
        if (dataset.revision !== 2 || form.revision < 2) {
          throw new Error('stale definition submitted');
        }
        return form.revision;
      });
      await Promise.all([expectBlocked(publish), expectBlocked(submission)]);
      releaseDraft.resolve();
      await draft;
      const [, submittedFormRevision] = await Promise.all([publish, submission]);

      expect(submittedFormRevision).toBeGreaterThanOrEqual(2);
      expect((await observerClient.form.findUniqueOrThrow({
        where: { id: fixture.formId },
      })).revision).toBe(3);
    } finally {
      releaseDraft.resolve();
      await cleanup(fixture);
    }
  });
});
