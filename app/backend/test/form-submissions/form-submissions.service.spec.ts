import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DatasetStatus,
  DatasetType,
  FormStatus,
  FormSubmissionAccess,
  FormSubmissionOperation,
  FormVersionState,
  FormWriteMode,
} from '@prisma/client';
import type { Sql } from '@prisma/client/runtime/library';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { checksumJson } from '@weave/utils';

import { FormSubmissionsService } from '../../src/form-submissions/form-submissions.service';

const itemA = 'q_11111111-1111-4111-8111-111111111111';
const itemB = 'q_22222222-2222-4222-8222-222222222222';

function schema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      [itemA]: {
        type: 'string',
        enum: ['yes', 'no'],
        'x-form': { datasetFieldId: 'field-a' },
      },
      [itemB]: {
        type: 'string',
        'x-form': { datasetFieldId: 'field-b' },
      },
    },
    required: [itemA],
    if: { properties: { [itemA]: { const: 'yes' } }, required: [itemA] },
    then: { required: [itemB] },
    'x-form': {
      version: 1, datasetId: 'dataset-1', capture: {},
    },
  };
}

function form(access = FormSubmissionAccess.anonymous_allowed) {
  return {
    id: 'form-1',
    workspaceId: 1,
    datasetId: 'dataset-1',
    status: FormStatus.active,
    dataset: { status: DatasetStatus.active, type: DatasetType.standard },
    activeVersion: {
      id: 'version-1',
      state: FormVersionState.published,
      opensAt: null,
      closesAt: null,
      submissionAccess: access,
      writeMode: FormWriteMode.create_row,
      schema: schema(),
    },
  };
}

function currentFields() {
  return [
    {
      id: 'field-a',
      datasetId: 'dataset-1',
      kind: 'single_select',
      valueSchema: { type: 'string', enum: ['yes', 'no'] },
      config: {},
      archivedAt: null,
      isSystemManaged: false,
      systemKey: null,
      relationCardinality: null,
      relationTargetDatasetId: null,
    },
    {
      id: 'field-b',
      datasetId: 'dataset-1',
      kind: 'text',
      valueSchema: { type: 'string' },
      config: {},
      archivedAt: null,
      isSystemManaged: false,
      systemKey: null,
      relationCardinality: null,
      relationTargetDatasetId: null,
    },
  ];
}

function validationPrisma(record = form()) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    form: { findUnique: vi.fn().mockResolvedValue(record) },
    formSubmission: { findUnique: vi.fn().mockResolvedValue(null) },
    datasetField: { findMany: vi.fn().mockResolvedValue(currentFields()) },
  };
  return {
    form: { findUnique: vi.fn().mockResolvedValue(record) },
    formSubmission: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
}

function service(prisma: object, overrides: {
  audit?: object;
  rateLimit?: object;
  relationValidation?: object;
  schemas?: object;
} = {}) {
  return new FormSubmissionsService(
    prisma as never,
    (overrides.schemas ?? {}) as never,
    {} as never,
    (overrides.audit ?? {}) as never,
    (overrides.relationValidation ?? {}) as never,
    (overrides.rateLimit ?? { consume: vi.fn() }) as never,
  );
}

describe('Form submission validation and idempotency', () => {
  it('rejects anonymous access before processing answers when authentication is required', async () => {
    const prisma = validationPrisma(form(FormSubmissionAccess.authentication_required));

    await expect(service(prisma).submitByPublicId('form-1', { answers: {} }, undefined, null, {}))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enforces conditional required fields and rejects unknown properties', async () => {
    const prisma = validationPrisma();
    const submissions = service(prisma);

    await expect(submissions.submitByPublicId('form-1', {
      answers: { [itemA]: 'yes' },
    }, undefined, null, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(submissions.submitByPublicId('form-1', {
      answers: { [itemA]: 'no', unknown: true },
    }, undefined, null, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns an identical idempotent result and conflicts on a changed payload', async () => {
    const payloadChecksum = await checksumJson({
      answers: { [itemA]: 'no' },
      expectedRevision: null,
    });
    const existing = {
      id: 'submission-1',
      formId: 'form-1',
      formVersionId: 'version-1',
      datasetId: 'dataset-1',
      rowId: 'row-1',
      rowVersionId: 'row-version-1',
      submitterUserId: null,
      operation: FormSubmissionOperation.created,
      payloadChecksum,
      submittedAt: new Date(),
    };
    const prisma = {
      form: { findUnique: vi.fn().mockResolvedValue(form()) },
      formSubmission: { findUnique: vi.fn().mockResolvedValue(existing) },
    };
    const rateLimit = { consume: vi.fn() };
    const submissions = service(prisma, { rateLimit });

    await expect(submissions.submitByPublicId('form-1', {
      answers: { [itemA]: 'no' },
    }, 'retry-1', null, {})).resolves.toMatchObject({ submissionId: 'submission-1' });
    await expect(submissions.submitByPublicId('form-1', {
      answers: { [itemA]: 'yes', [itemB]: 'changed' },
    }, 'retry-1', null, {})).rejects.toBeInstanceOf(ConflictException);
    expect(rateLimit.consume).not.toHaveBeenCalled();
  });

  it('rejects submitted values whose availableIf condition is false', async () => {
    const record = form();
    record.activeVersion.schema.properties[itemB]['x-form'] = {
      datasetFieldId: 'field-b',
      availableIf: { fieldId: itemA, operator: 'equals', value: 'yes' },
    };
    const prisma = validationPrisma(record);

    await expect(service(prisma).submitByPublicId('form-1', {
      answers: { [itemA]: 'no', [itemB]: 'injected' },
    }, undefined, null, { networkIdentity: '127.0.0.1' }))
      .rejects.toThrow('Form answers contain unavailable items');
  });

  it('rejects a direct relation target that bypasses the authoritative Form filter', async () => {
    const countryItemId = itemA;
    const relationItemId = itemB;
    const record = form();
    record.activeVersion.schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        [countryItemId]: {
          type: 'string',
          'x-form': { datasetFieldId: 'field-country-source', position: 0 },
        },
        [relationItemId]: {
          type: 'string',
          'x-form': {
            datasetFieldId: 'field-city',
            position: 1,
            ui: {
              widget: 'selector',
              options: {
                labelFieldId: 'field-label',
                filter: {
                  all: [{
                    fieldId: 'field-country',
                    operator: 'equals',
                    valueFrom: countryItemId,
                  }],
                },
              },
            },
          },
        },
      },
      required: [countryItemId, relationItemId],
      'x-form': { version: 1, datasetId: 'dataset-1', capture: {} },
    };
    const fields = [
      {
        ...currentFields()[1],
        id: 'field-country-source',
      },
      {
        ...currentFields()[1],
        id: 'field-city',
        kind: 'relation',
        relationCardinality: 'one',
        relationTargetDatasetId: 'dataset-cities',
      },
    ];
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      form: { findUnique: vi.fn().mockResolvedValue(record) },
      formSubmission: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      datasetField: { findMany: vi.fn().mockResolvedValue(fields) },
      datasetRow: { create: vi.fn() },
      datasetRowSubject: { findUnique: vi.fn() },
    };
    const prisma = {
      form: { findUnique: vi.fn().mockResolvedValue(record) },
      formSubmission: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const schemas = {
      validateRow: vi.fn().mockReturnValue({
        values: { 'field-country-source': 'CN' },
        relations: new Map([['field-city', ['row-paris']]]),
      }),
    };
    const relationValidation = {
      validate: vi.fn().mockResolvedValue([{
        id: 'row-paris',
        workspaceId: 1,
        datasetId: 'dataset-cities',
        deletedAt: null,
        values: { 'field-country': 'FR', 'field-label': 'Paris' },
      }]),
    };
    const audit = { record: vi.fn() };

    await expect(service(prisma, {
      audit,
      relationValidation,
      schemas,
    }).submitByPublicId('form-1', {
      answers: { [countryItemId]: 'CN', [relationItemId]: 'row-paris' },
    }, undefined, null, { networkIdentity: '127.0.0.1' }))
      .rejects.toThrow('Relation target does not satisfy the Form filter');

    expect(relationValidation.validate).toHaveBeenCalledWith(
      tx,
      1,
      fields,
      new Map([['field-city', ['row-paris']]]),
      { updateRowIds: [] },
    );
    expect(tx.datasetRow.create).not.toHaveBeenCalled();
    expect(tx.formSubmission.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns a minimal public result, records the actor, and captures User-Agent metadata', async () => {
    const events: string[] = [];
    const submittedAt = new Date('2026-08-08T08:00:00.000Z');
    const record = form();
    record.activeVersion.schema['x-form'].capture = {
      userAgent: { datasetFieldId: 'field-user-agent' },
    };
    const tx = {
      $queryRaw: vi.fn((query: Sql) => {
        events.push(query.strings.join('').includes('Dataset"') ? 'dataset-lock' : 'form-lock');
        return [];
      }),
      form: {
        findUnique: vi.fn().mockImplementation(() => {
          events.push('form-read');
          return record;
        }),
      },
      formSubmission: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'submission-created',
          formId: 'form-1',
          formVersionId: 'version-1',
          datasetId: 'dataset-1',
          rowId: 'row-created',
          rowVersionId: 'row-version-created',
          submitterUserId: 'user-1',
          operation: FormSubmissionOperation.created,
          submittedAt,
        }),
      },
      datasetField: {
        findMany: vi.fn().mockImplementation(() => {
          events.push('field-read');
          return currentFields();
        }),
      },
      datasetRowSubject: { findUnique: vi.fn().mockResolvedValue(null) },
      datasetRow: { create: vi.fn().mockResolvedValue({ id: 'row-created', revision: 1 }) },
      datasetRelation: { createMany: vi.fn() },
      datasetRowVersion: { create: vi.fn().mockResolvedValue({ id: 'row-version-created' }) },
    };
    const prisma = {
      form: { findUnique: vi.fn().mockResolvedValue(record) },
      formSubmission: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const schemas = {
      validateRow: vi.fn((_fields, normalized) => ({
        values: normalized.values,
        relations: new Map(),
      })),
    };
    const audit = { record: vi.fn() };
    const relationValidation = { validate: vi.fn().mockResolvedValue([]) };
    const rateLimit = { consume: vi.fn() };
    const actor = {
      userId: 'user-1',
      workspaceId: 1,
      sessionId: 'session-1',
      permissions: [],
      isSystemAdmin: false,
      isWorkspaceAdmin: false,
    };

    const result = await service(prisma, {
      audit,
      rateLimit,
      relationValidation,
      schemas,
    }).submitByPublicId('form-1', {
      answers: { [itemA]: 'no' },
    }, 'create-key', actor, {
      networkIdentity: '127.0.0.1',
      userAgent: 'Mozilla/5.0 TestBrowser',
    });

    expect(result).toEqual({
      submissionId: 'submission-created',
      operation: FormSubmissionOperation.created,
      submittedAt: submittedAt.toISOString(),
    });
    expect(result).not.toHaveProperty('rowId');
    expect(tx.datasetRow.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        createdByUserId: 'user-1',
        values: expect.objectContaining({ 'field-user-agent': 'Mozilla/5.0 TestBrowser' }),
      }),
    }));
    expect(tx.formSubmission.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ submitterUserId: 'user-1' }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'form.submit',
      result: 'success',
    }), tx);
    expect(events.slice(0, 4)).toEqual([
      'dataset-lock',
      'form-lock',
      'form-read',
      'field-read',
    ]);
    const queries = tx.$queryRaw.mock.calls.map(([query]) => query as Sql);
    expect(queries.every((query) => query.strings.join('').includes('FOR SHARE'))).toBe(true);
  });

  it('rejects a new write when the public rate limiter denies it', async () => {
    const prisma = {
      form: { findUnique: vi.fn().mockResolvedValue(form()) },
      $transaction: vi.fn(),
    };
    const rateLimit = { consume: vi.fn().mockRejectedValue(new Error('rate limited')) };

    await expect(service(prisma, { rateLimit }).submitByPublicId('form-1', {
      answers: { [itemA]: 'no' },
    }, undefined, null, { networkIdentity: 'shared-ip' })).rejects.toThrow('rate limited');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('Subject-row filling and update', () => {
  const actor = {
    userId: 'user-1',
    workspaceId: 1,
    sessionId: 'session-1',
    permissions: [],
    isSystemAdmin: false,
    isWorkspaceAdmin: false,
  };

  function updateForm() {
    const record = form(FormSubmissionAccess.authentication_required);
    record.activeVersion.writeMode = FormWriteMode.update_subject_row;
    record.activeVersion.schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        [itemA]: { type: 'string', 'x-form': { datasetFieldId: 'field-a' } },
        [itemB]: { type: 'array', 'x-form': { datasetFieldId: 'field-b' } },
      },
      'x-form': { version: 1, datasetId: 'dataset-1', capture: {} },
    };
    return record;
  }

  it('maps the actor subject row values, relation targets, and revision', async () => {
    const prisma = {
      form: { findUnique: vi.fn().mockResolvedValue(updateForm()) },
      datasetRowSubject: {
        findUnique: vi.fn().mockResolvedValue({
          rowId: 'row-1',
          row: {
            deletedAt: null,
            revision: 7,
            values: { 'field-a': 'current' },
            sourceRelations: [
              { fieldId: 'field-b', targetRowId: 'target-2', position: 1 },
              { fieldId: 'field-b', targetRowId: 'target-1', position: 0 },
            ],
          },
        }),
      },
      datasetField: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'field-a', kind: 'text', relationCardinality: null },
          { id: 'field-b', kind: 'relation', relationCardinality: 'many' },
        ]),
      },
    };

    await expect(service(prisma).getSubjectContext('form-1', actor)).resolves.toEqual({
      answers: { [itemA]: 'current', [itemB]: ['target-1', 'target-2'] },
      expectedRevision: 7,
    });
  });

  it('returns no context when the actor has no live subject row', async () => {
    const prisma = {
      form: { findUnique: vi.fn().mockResolvedValue(updateForm()) },
      datasetRowSubject: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    await expect(service(prisma).getSubjectContext('form-1', actor)).resolves.toBeNull();
  });

  it.each([1, 0])('updates only the actor subject row with CAS count %i', async (count) => {
    const record = updateForm();
    record.activeVersion.schema.properties = {
      [itemA]: { type: 'string', 'x-form': { datasetFieldId: 'field-a' } },
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      form: { findUnique: vi.fn().mockResolvedValue(record) },
      formSubmission: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'submission-update',
          formId: 'form-1',
          formVersionId: 'version-1',
          datasetId: 'dataset-1',
          rowId: 'row-1',
          rowVersionId: 'row-version-2',
          submitterUserId: actor.userId,
          operation: FormSubmissionOperation.updated,
          submittedAt: new Date('2026-08-08T08:00:00.000Z'),
        }),
      },
      datasetRowSubject: {
        findUnique: vi.fn().mockResolvedValue({
          rowId: 'row-1',
          row: { values: { 'field-a': 'old' }, sourceRelations: [] },
        }),
      },
      datasetRow: {
        updateMany: vi.fn().mockResolvedValue({ count }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'row-1', revision: 2 }),
      },
      datasetField: {
        findMany: vi.fn().mockResolvedValue([{
          ...currentFields()[1],
          id: 'field-a',
        }]),
      },
      datasetRelation: { deleteMany: vi.fn(), createMany: vi.fn() },
      datasetRowVersion: { create: vi.fn().mockResolvedValue({ id: 'row-version-2' }) },
    };
    const prisma = {
      form: { findUnique: vi.fn().mockResolvedValue(record) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const schemas = {
      validateRow: vi.fn().mockReturnValue({
        values: { 'field-a': 'new' },
        relations: new Map(),
      }),
    };
    const dependencies = {
      audit: { record: vi.fn() },
      relationValidation: { validate: vi.fn().mockResolvedValue([]) },
      schemas,
    };
    const promise = service(prisma, dependencies).submitByPublicId('form-1', {
      answers: { [itemA]: 'new' },
      expectedRevision: 1,
    }, undefined, actor, { networkIdentity: '127.0.0.1' });

    if (count === 1) {
      await expect(promise).resolves.toMatchObject({ operation: FormSubmissionOperation.updated });
      expect(tx.datasetRow.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'row-1', revision: 1 }),
      }));
    } else {
      await expect(promise).rejects.toThrow('Dataset row revision is stale');
      expect(tx.formSubmission.create).not.toHaveBeenCalled();
    }
  });
});
