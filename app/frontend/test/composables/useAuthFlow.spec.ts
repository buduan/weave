import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { computed, readonly, shallowRef } from 'vue';

import { apiStatuses } from '@weave/types';

import { toApiError } from '~/utils/api';
import { authErrorMessage, useAuthFlow } from '~/composables/useAuthFlow';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authentication business errors', () => {
  it('turns account_not_found into an actionable inline message', () => {
    const error = {
      statusCode: 400,
      data: {
        status: apiStatuses.accountNotFound,
        data: null,
        message: 'Account not found',
        timestamp: new Date().toISOString(),
      },
    };
    const apiError = toApiError(error);

    expect(apiError.httpStatus).toBe(400);
    expect(apiError.status).toBe(apiStatuses.accountNotFound);
    expect(authErrorMessage(error)).toBe('账号不存在，请输入邮箱以创建账号。');
  });

  it('shows the business error through Nuxt UI toast', async () => {
    const error = {
      statusCode: 400,
      data: {
        status: apiStatuses.accountNotFound,
        data: null,
        message: 'Account not found',
        timestamp: new Date().toISOString(),
      },
    };
    const add = vi.fn();
    const api = { post: vi.fn().mockRejectedValue(error) };
    const pinia = {};
    vi.stubGlobal('computed', computed);
    vi.stubGlobal('readonly', readonly);
    vi.stubGlobal('shallowRef', shallowRef);
    vi.stubGlobal('useNuxtApp', () => ({ $api: api, $pinia: pinia }));
    vi.stubGlobal('useAuthStore', () => ({ completeAuthentication: vi.fn() }));
    vi.stubGlobal('useToast', () => ({ add }));

    const flow = useAuthFlow();
    await expect(flow.discover('missing-user')).rejects.toBe(error);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      title: '操作未完成',
      description: '账号不存在，请输入邮箱以创建账号。',
      color: 'error',
    }));
  });
});
