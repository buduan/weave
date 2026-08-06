import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { WorkspacesService } from '../../src/workspaces/workspaces.service';

describe('first-release Workspace boundary', () => {
  it('accepts Workspace 1 and rejects cross-Workspace access', () => {
    const service = new WorkspacesService(
      {} as never,
      { get: () => '1' } as never,
      {} as never,
      {} as never,
    );

    expect(() => service.assertDefault(1)).not.toThrow();
    expect(() => service.assertDefault(2)).toThrow(BadRequestException);
  });
});

describe('Workspace member types', () => {
  it('does not allow the required guest type to be deleted', async () => {
    const prisma = {
      workspaceMemberType: {
        findUnique: vi.fn().mockResolvedValue({ id: 'guest-1', workspaceId: 1, isSystem: true }),
      },
    };
    const service = new WorkspacesService(
      prisma as never,
      { get: () => '1' } as never,
      {} as never,
      {} as never,
    );

    await expect(service.deleteMemberType(1, 'guest-1', 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects member-type assignment from another Workspace', async () => {
    const tx = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-1', workspaceId: 1 }) },
      workspaceMemberType: { findUnique: vi.fn().mockResolvedValue({ id: 'type-2', workspaceId: 2 }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new WorkspacesService(
      prisma as never,
      { get: () => '1' } as never,
      {} as never,
      {} as never,
    );

    await expect(service.updateMember(1, 'member-1', { memberTypeId: 'type-2' }, 'admin-1'))
      .rejects.toThrow('Member type not found');
  });
});
