import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  describe, expect, it, vi,
} from 'vitest';

import {
  isPermissionKey,
  permissionKeys,
  workspacePermissionKeys,
} from '@weave/types';

import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { resolveEffectivePermissions } from '../../src/authorization/effective-permissions';

describe('effective permission precedence', () => {
  it('registers the Dataset and Form capabilities as Workspace permissions', () => {
    expect([
      'activity.manage',
      'dataset.create',
      'dataset.manage_all',
      'dataset.read_all',
      'form.manage_all',
      'join_request.review',
    ].every(isPermissionKey)).toBe(true);
  });

  it('unions roles, adds direct allow and applies direct deny last', () => {
    expect(resolveEffectivePermissions({
      directPermissions: [
        { effect: 'allow', permissionKey: 'audit.read' },
        { effect: 'deny', permissionKey: 'role.read' },
      ],
      isSystemAdmin: false,
      isWorkspaceAdmin: false,
      rolePermissionKeys: ['role.read', 'user.read'],
    })).toEqual(['audit.read', 'user.read']);
  });

  it('does not let ordinary deny restrict administrator authority', () => {
    expect(resolveEffectivePermissions({
      directPermissions: [{ effect: 'deny', permissionKey: 'user.read' }],
      isSystemAdmin: true,
      isWorkspaceAdmin: false,
      rolePermissionKeys: [],
    })).toEqual([...permissionKeys].sort());
    expect(resolveEffectivePermissions({
      directPermissions: [{ effect: 'deny', permissionKey: 'user.read' }],
      isSystemAdmin: false,
      isWorkspaceAdmin: true,
      rolePermissionKeys: [],
    })).toEqual(['workspace_admin', ...workspacePermissionKeys].sort());
  });
});

describe('administrator boundaries', () => {
  it('rejects concurrent attempts that each observe the last active administrator', async () => {
    const transaction = vi.fn(async (
      callback: (client: unknown) => Promise<void>,
      options: unknown,
    ) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await callback({
        systemAdministrator: {
          findUnique: vi.fn().mockResolvedValue({ user: { status: 'active' } }),
          count: vi.fn().mockResolvedValue(1),
          delete: vi.fn(),
        },
        auditLog: { create: vi.fn() },
      });
    });
    const prisma = {
      $transaction: transaction,
      auditLog: { create: vi.fn() },
    };
    const reauthentication = { verify: vi.fn().mockResolvedValue(undefined) };
    const workspaces = { assertDefault: vi.fn() };
    const service = new AuthorizationService(
      prisma as never,
      reauthentication as never,
      workspaces as never,
      new AuditService(prisma as never),
    );

    const results = await Promise.allSettled([
      service.revokeSystemAdministrator('admin-1', 'admin-1', { password: 'Valid123!' }),
      service.revokeSystemAdministrator('admin-1', 'admin-1', { password: 'Valid123!' }),
    ]);

    expect(results.every((result) => (
      result.status === 'rejected' && result.reason instanceof ConflictException
    ))).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects reserved administrator labels in ordinary grants', () => {
    const service = new AuthorizationService({} as never, {} as never, {} as never, {} as never);
    expect(() => service.assertGrantKeys(['system_admin'])).toThrow();
    expect(() => service.assertGrantKeys(['workspace_admin'])).toThrow();
    expect(() => service.assertGrantKeys(['not.registered'])).toThrow();
  });
});
