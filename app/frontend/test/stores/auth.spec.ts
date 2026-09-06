/* eslint-disable import/no-extraneous-dependencies -- Vue is provided by Nuxt at runtime */
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  computed, ref, shallowRef, type Ref,
} from 'vue';

import { apiStatuses, type AuthTokens, type UserProfile } from '@weave/types';

import { ApiError } from '~/utils/api';
import { useAuthStore } from '~/stores/auth';

const cookies = new Map<string, Ref<string | null>>();
const api = {
  get: vi.fn(),
  post: vi.fn(),
};

const firstTokens: AuthTokens = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessTokenExpiresIn: 900,
};
const secondTokens: AuthTokens = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  accessTokenExpiresIn: 600,
};
const profile: UserProfile = {
  id: 'user-1',
  email: 'user@example.com',
  username: 'user',
  name: 'User',
  nickname: 'User',
  avatarUrl: null,
  phone: null,
  emailVerifiedAt: new Date().toISOString(),
  phoneVerifiedAt: null,
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function createStore() {
  const pinia = createPinia();
  setActivePinia(pinia);
  vi.stubGlobal('useNuxtApp', () => ({ $api: api, $pinia: pinia }));
  return useAuthStore(pinia);
}

describe('auth Pinia Token state', () => {
  beforeEach(() => {
    cookies.clear();
    vi.clearAllMocks();
    vi.stubGlobal('computed', computed);
    vi.stubGlobal('shallowRef', shallowRef);
    vi.stubGlobal('useCookie', (name: string, options?: { default?: () => null }) => {
      if (!cookies.has(name)) cookies.set(name, ref(options?.default?.() ?? null));
      return cookies.get(name);
    });
    vi.stubGlobal('useRoute', () => ({ fullPath: '/dashboard' }));
    vi.stubGlobal('navigateTo', vi.fn());
  });

  it.each([
    'password',
    'email code',
    'direct Passkey',
    'email MFA',
    'SMS MFA',
    'TOTP MFA',
    'Passkey MFA',
    'full registration',
    'simple registration',
  ])('stores both Tokens before profile fetch for %s completion', async () => {
    api.get.mockImplementation(async () => {
      const store = useAuthStore();
      expect(store.accessToken).toBe(firstTokens.accessToken);
      expect(store.refreshToken).toBe(firstTokens.refreshToken);
      return profile;
    });
    const store = createStore();

    await store.completeAuthentication(firstTokens);

    expect(store.profile).toEqual(profile);
    expect(cookies.get('orz_access_token')?.value).toBe(firstTokens.accessToken);
    expect(cookies.get('orz_refresh_token')?.value).toBe(firstTokens.refreshToken);
  });

  it('atomically replaces the Token pair on Refresh', async () => {
    const store = createStore();
    store.setTokens(firstTokens);
    api.post.mockResolvedValue(secondTokens);

    await store.refreshTokens();

    expect(store.accessToken).toBe(secondTokens.accessToken);
    expect(store.refreshToken).toBe(secondTokens.refreshToken);
  });

  it('retains Tokens after a non-401 profile failure', async () => {
    api.get.mockRejectedValue(new ApiError(503, apiStatuses.internalError, 'Unavailable'));
    const store = createStore();

    await expect(store.completeAuthentication(firstTokens)).rejects.toThrow('Unavailable');
    expect(store.accessToken).toBe(firstTokens.accessToken);
    expect(store.refreshToken).toBe(firstTokens.refreshToken);
  });

  it('clears both Token state and cookies after a 401 or failed Refresh', async () => {
    api.get.mockRejectedValue(new ApiError(401, apiStatuses.unauthorized, 'Unauthorized'));
    const store = createStore();
    await expect(store.completeAuthentication(firstTokens)).rejects.toThrow('Unauthorized');
    expect(store.accessToken).toBeNull();
    expect(store.refreshToken).toBeNull();

    store.setTokens(firstTokens);
    api.post.mockRejectedValue(new ApiError(401, apiStatuses.unauthorized, 'Unauthorized'));
    await expect(store.refreshTokens()).rejects.toThrow('Unauthorized');
    expect(cookies.get('orz_access_token')?.value).toBeNull();
    expect(cookies.get('orz_refresh_token')?.value).toBeNull();
  });

  it('hydrates Pinia Token refs from cookie backing after reload', () => {
    cookies.set('orz_access_token', ref(firstTokens.accessToken));
    cookies.set('orz_refresh_token', ref(firstTokens.refreshToken));

    const store = createStore();

    expect(store.accessToken).toBe(firstTokens.accessToken);
    expect(store.refreshToken).toBe(firstTokens.refreshToken);
    expect(store.isAuthenticated).toBe(true);
  });

  it('clears both Tokens on logout and on the access-401 callback', async () => {
    api.post.mockResolvedValue({ accepted: true });
    const store = createStore();
    store.setTokens(firstTokens);

    await store.logout();
    expect(store.accessToken).toBeNull();
    expect(store.refreshToken).toBeNull();

    store.setTokens(firstTokens);
    store.onAccessTokenExpired();
    expect(store.accessToken).toBeNull();
    expect(store.refreshToken).toBeNull();
  });
});
