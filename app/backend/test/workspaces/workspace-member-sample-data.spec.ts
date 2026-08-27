import { MemberStatus } from '@prisma/client';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { JsonValue } from '@weave/types';
import { checksumJson } from '@weave/utils';

import { UsersService } from '../../src/users/users.service';
import {
  ensureWorkspaceMemberSampleData,
} from '../../src/workspaces/workspace-member-sample-data';
import { WorkspacesService } from '../../src/workspaces/workspaces.service';

interface SampleStore {
  dataset: {
    fields: Array<Record<string, unknown>>;
    id: string;
    revision: number;
    slug: string;
  } | null;
  form: { datasetId: string; id: string; slug: string } | null;
}

function createSampleTransaction(memberId: string) {
  const store: SampleStore = { dataset: null, form: null };
  const datasetCreate = vi.fn(async ({ data }: { data: { slug: string } }) => {
    const field = {
      id: `field-${memberId}`,
      key: 'name',
      name: '姓名',
      description: null,
      dataType: 'string',
      kind: 'text',
      valueSchema: { type: 'string', minLength: 1, maxLength: 128 },
      config: {},
      required: true,
      isSystemManaged: false,
      systemKey: null,
      relationTargetDatasetId: null,
      relationCardinality: null,
      position: 0,
      revision: 1,
      archivedAt: null,
    };
    store.dataset = {
      id: `dataset-${memberId}`,
      revision: 1,
      slug: data.slug,
      fields: [field],
    };
    return store.dataset;
  });
  const formCreate = vi.fn(async ({ data }: { data: { slug: string } }) => {
    store.form = { id: `form-${memberId}`, datasetId: store.dataset!.id, slug: data.slug };
    return store.form;
  });
  const datasetFind = vi.fn(async ({
    where,
  }: { where: { workspaceId_slug: { slug: string } } }) => (
    store.dataset?.slug === where.workspaceId_slug.slug ? { id: store.dataset.id } : null
  ));
  const formFind = vi.fn(async ({
    where,
  }: { where: { workspaceId_slug: { slug: string } } }) => (
    store.form?.slug === where.workspaceId_slug.slug ? store.form : null
  ));
  const tx = {
    dataset: {
      create: datasetCreate,
      findUnique: datasetFind,
      findUniqueOrThrow: vi.fn(async () => ({
        ...store.dataset,
        name: '示例数据集',
        description: '用于体验数据集和表单功能的示例数据。',
        type: 'standard',
        status: 'active',
        subjectMode: 'none',
        fields: store.dataset?.fields ?? [],
      })),
    },
    datasetVersion: { create: vi.fn() },
    form: { create: formCreate, findUnique: formFind, update: vi.fn() },
    formVersion: {
      create: vi.fn(async () => ({ id: `version-${memberId}` })),
    },
  };
  return {
    store,
    tx,
    datasetCreate,
    formCreate,
    datasetFind,
    formFind,
  };
}

describe('Workspace member sample data', () => {
  it('creates a complete member-owned Dataset and published Form', async () => {
    const fixture = createSampleTransaction('member-1');
    const result = await ensureWorkspaceMemberSampleData(fixture.tx as never, {
      workspaceId: 1,
      workspaceMemberId: 'member-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      created: true,
      datasetId: 'dataset-member-1',
      formId: 'form-member-1',
    });
    expect(fixture.datasetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        slug: 'example-dataset-member-1',
        createdByUserId: 'user-1',
        collaborators: {
          create: expect.objectContaining({
            workspaceMemberId: 'member-1',
            role: 'owner',
          }),
        },
      }),
    }));
    expect(fixture.store.dataset?.fields[0]).toEqual(expect.objectContaining({
      id: 'field-member-1',
      required: true,
      kind: 'text',
    }));
    expect(fixture.tx.datasetVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        datasetId: 'dataset-member-1',
        version: 1,
        reason: 'dataset.create',
        createdByUserId: 'user-1',
      }),
    }));

    const versionData = (fixture.tx.formVersion.create as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].data as Record<string, unknown>;
    const schema = versionData.schema as JsonValue;
    expect(versionData.state).toBe('published');
    expect(versionData.publishedByUserId).toBe('user-1');
    expect(versionData.schemaChecksum).toBe(await checksumJson(schema));
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.any(Array),
      'x-form': expect.objectContaining({ datasetId: 'dataset-member-1' }),
    });
    expect(fixture.tx.form.update).toHaveBeenCalledWith({
      where: { id: 'form-member-1' },
      data: { activeVersionId: 'version-member-1' },
    });
  });

  it('gives two members distinct slugs and owner collaborators', async () => {
    const first = createSampleTransaction('member-1');
    const second = createSampleTransaction('member-2');
    await ensureWorkspaceMemberSampleData(first.tx as never, {
      workspaceId: 1,
      workspaceMemberId: 'member-1',
      userId: 'user-1',
    });
    await ensureWorkspaceMemberSampleData(second.tx as never, {
      workspaceId: 1,
      workspaceMemberId: 'member-2',
      userId: 'user-2',
    });

    expect(first.store.dataset?.slug).toBe('example-dataset-member-1');
    expect(second.store.dataset?.slug).toBe('example-dataset-member-2');
    expect(first.formCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ slug: 'example-form-member-1' }),
    }));
    expect(second.formCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ slug: 'example-form-member-2' }),
    }));
    expect(first.datasetCreate.mock.calls[0][0].data.collaborators.create.workspaceMemberId)
      .toBe('member-1');
    expect(second.datasetCreate.mock.calls[0][0].data.collaborators.create.workspaceMemberId)
      .toBe('member-2');
  });

  it('is idempotent for a complete pair and rejects an incomplete pair', async () => {
    const fixture = createSampleTransaction('member-1');
    const input = { workspaceId: 1, workspaceMemberId: 'member-1', userId: 'user-1' };
    const first = await ensureWorkspaceMemberSampleData(fixture.tx as never, input);
    const second = await ensureWorkspaceMemberSampleData(fixture.tx as never, input);

    expect(second).toEqual({ ...first, created: false });
    expect(fixture.datasetCreate).toHaveBeenCalledTimes(1);
    expect(fixture.formCreate).toHaveBeenCalledTimes(1);
    expect(fixture.tx.datasetVersion.create).toHaveBeenCalledTimes(1);
    expect(fixture.tx.formVersion.create).toHaveBeenCalledTimes(1);
    expect(fixture.tx.form.update).toHaveBeenCalledTimes(1);

    fixture.store.form = null;
    await expect(ensureWorkspaceMemberSampleData(fixture.tx as never, input))
      .rejects.toThrow('sample Dataset/Form pair is incomplete');
  });
});

function createLifecycleService(
  memberStatus: MemberStatus,
  update: { memberTypeId?: string; status?: MemberStatus },
  sampleFailure = false,
) {
  const sample = createSampleTransaction('member-1');
  const member = {
    id: 'member-1',
    workspaceId: 1,
    userId: 'user-1',
    memberTypeId: 'guest-1',
    status: memberStatus,
  };
  const tx = {
    ...sample.tx,
    workspace: { findUniqueOrThrow: vi.fn().mockResolvedValue({ ownerUserId: 'owner-1' }) },
    workspaceMember: {
      findUnique: vi.fn().mockResolvedValue(member),
      update: vi.fn().mockImplementation(async ({ data }: { data: typeof update }) => ({
        ...member,
        ...data,
      })),
    },
    workspaceMemberType: {
      findUnique: vi.fn().mockResolvedValue({ id: 'type-1', workspaceId: 1 }),
    },
    auditLog: { create: vi.fn() },
  };
  if (sampleFailure) {
    tx.dataset.create.mockRejectedValue(new Error('sample write failed'));
  }
  const prisma = {
    $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const service = new WorkspacesService(
    prisma as never,
    { get: () => '1' } as never,
    { synchronize: vi.fn().mockResolvedValue(undefined) } as never,
  );
  return {
    service,
    sample,
    tx,
    prisma,
  };
}

describe('Workspace member activation boundaries', () => {
  it('provisions on pending-to-active and records the result on the existing audit', async () => {
    const fixture = createLifecycleService(MemberStatus.pending, { status: MemberStatus.active });

    await fixture.service.updateMember(1, 'member-1', { status: MemberStatus.active }, 'admin-1');

    expect(fixture.sample.datasetCreate).toHaveBeenCalledTimes(1);
    expect(fixture.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'workspace.member.update',
        metadata: expect.objectContaining({
          sampleData: expect.objectContaining({ created: true }),
        }),
      }),
    }));
  });

  it.each([
    ['member-type-only', MemberStatus.pending, { memberTypeId: 'type-2' }],
    ['suspension', MemberStatus.active, { status: MemberStatus.suspended }],
    ['removal', MemberStatus.active, { status: MemberStatus.removed }],
    ['suspended restoration', MemberStatus.suspended, { status: MemberStatus.active }],
  ])('does not provision for %s', async (_name, currentStatus, update) => {
    const fixture = createLifecycleService(currentStatus, update);

    await fixture.service.updateMember(1, 'member-1', update, 'admin-1');

    expect(fixture.sample.datasetFind).not.toHaveBeenCalled();
    expect(fixture.sample.formFind).not.toHaveBeenCalled();
    expect(fixture.sample.datasetCreate).not.toHaveBeenCalled();
  });

  it('does not provision while registration only creates a pending member', async () => {
    const createdAt = new Date('2026-07-26T00:00:00.000Z');
    const tx = {
      auditLog: { create: vi.fn() },
      memberRole: { create: vi.fn() },
      role: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'role-1' }) },
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user-1',
          email: 'user@example.com',
          username: 'example_user',
          name: 'Example User',
          nickname: 'Example User',
          avatarUrl: null,
          phone: null,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          status: MemberStatus.pending,
          createdAt,
          updatedAt: createdAt,
        }),
      },
      workspaceMember: { create: vi.fn().mockResolvedValue({ id: 'member-1' }) },
      workspaceMemberType: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'guest-1' }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new UsersService(prisma as never, {} as never, { record: vi.fn() } as never);

    await service.create({
      email: 'user@example.com',
      username: 'example_user',
      name: 'Example User',
      nickname: 'Example User',
    });

    expect(tx.workspaceMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: MemberStatus.pending }),
    });
    expect(tx).not.toHaveProperty('dataset');
  });

  it('rolls back activation when sample persistence fails', async () => {
    const state = { status: MemberStatus.pending };
    const fixture = createLifecycleService(
      MemberStatus.pending,
      { status: MemberStatus.active },
      true,
    );
    fixture.prisma.$transaction.mockImplementation(async (callback) => {
      const before = state.status;
      try {
        const result = await callback(fixture.tx);
        state.status = MemberStatus.active;
        return result;
      } catch (error) {
        state.status = before;
        throw error;
      }
    });

    await expect(fixture.service.updateMember(1, 'member-1', {
      status: MemberStatus.active,
    }, 'admin-1')).rejects.toThrow('sample write failed');
    expect(state.status).toBe(MemberStatus.pending);
  });
});
