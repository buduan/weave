import { FormStatus } from '@prisma/client';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { AuthenticatedActor } from '@weave/types';

import { FormsController } from '../../src/forms/forms.controller';

const actor: AuthenticatedActor = {
  userId: 'admin-1',
  workspaceId: 1,
  sessionId: 'session-1',
  permissions: [],
  isSystemAdmin: false,
  isWorkspaceAdmin: true,
};

describe('FormsController lifecycle routes', () => {
  it.each([
    ['closeForm', 'close', FormStatus.closed],
    ['reopenForm', 'reopen', FormStatus.active],
    ['archiveForm', 'archive', FormStatus.archived],
    ['unarchiveForm', 'restore', FormStatus.active],
  ] as const)('routes %s through the %s mutation', async (method, operation, status) => {
    const forms = {
      archive: vi.fn(),
      close: vi.fn(),
      reopen: vi.fn(),
      restore: vi.fn(),
    };
    forms[operation].mockResolvedValue({ status });
    const controller = new FormsController(forms as never);
    const dto = { formId: 'form-1', expectedRevision: 7 };

    await controller[method](1, dto, actor);

    expect(forms[operation]).toHaveBeenCalledWith(1, 'form-1', 7, actor);
  });
});
