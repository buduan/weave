import type {
  AuthenticatedActor,
  AuthTokens,
  UserProfile,
} from '@weave/types';
import { acceptHMRUpdate, defineStore } from 'pinia';

import { ApiError } from '~/utils/api';
import { resolveSafeRedirect } from '~/utils/redirect';

const refreshTokenMaxAge = 60 * 60 * 24 * 30;

export const useAuthStore = defineStore('auth', () => {
  const accessTokenCookie = useCookie<string | null>('orz_access_token', {
    default: () => null,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  const refreshTokenCookie = useCookie<string | null>('orz_refresh_token', {
    default: () => null,
    maxAge: refreshTokenMaxAge,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  // These refs are the only application Token state. Cookies only hydrate and persist them.
  const accessToken = shallowRef<string | null>(accessTokenCookie.value);
  const refreshToken = shallowRef<string | null>(refreshTokenCookie.value);
  const profile = shallowRef<UserProfile | null>(null);
  const actor = shallowRef<AuthenticatedActor | null>(null);

  const isAuthenticated = computed(() => Boolean(accessToken.value));
  const isSystemAdmin = computed(() => actor.value?.isSystemAdmin ?? false);
  const isWorkspaceAdmin = computed(() => actor.value?.isWorkspaceAdmin ?? false);

  function hasPermission(key: string): boolean {
    return actor.value?.permissions.includes(key as never) ?? false;
  }

  function setTokens(tokens: AuthTokens): void {
    // Update the pair synchronously before exposing the state to component observers.
    accessToken.value = tokens.accessToken;
    refreshToken.value = tokens.refreshToken;

    const persistedAccessToken = useCookie<string | null>('orz_access_token', {
      maxAge: tokens.accessTokenExpiresIn,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    persistedAccessToken.value = tokens.accessToken;
    refreshTokenCookie.value = tokens.refreshToken;
  }

  function setProfile(user: UserProfile): void {
    profile.value = user;
  }

  function setActor(actorData: AuthenticatedActor): void {
    actor.value = actorData;
  }

  function clear(): void {
    accessToken.value = null;
    refreshToken.value = null;
    profile.value = null;
    actor.value = null;
    accessTokenCookie.value = null;
    refreshTokenCookie.value = null;
  }

  function onAccessTokenExpired(): void {
    clear();

    if (import.meta.client) {
      const route = useRoute();
      const redirect = resolveSafeRedirect(route.fullPath, window.location.origin);
      navigateTo({ path: '/auth/login', query: { redirect } });
    }
  }

  async function fetchProfile(): Promise<void> {
    const { $api } = useNuxtApp();
    const user = await $api.get<UserProfile>('/user/me');
    setProfile(user);
  }

  async function completeAuthentication(tokens: AuthTokens): Promise<void> {
    setTokens(tokens);
    try {
      await fetchProfile();
    } catch (error: unknown) {
      // The API client clears a definitively invalid Session on 401. Transient
      // profile failures retain the valid Tokens so the caller can retry.
      if (error instanceof ApiError && error.httpStatus === 401) clear();
      throw error;
    }
  }

  async function refreshTokens(): Promise<string | null> {
    if (!refreshToken.value) {
      clear();
      return null;
    }

    const { $api } = useNuxtApp();
    try {
      const tokens = await $api.post<AuthTokens>(
        '/auth/token/refresh',
        undefined,
        { auth: 'refresh' },
      );
      setTokens(tokens);
      return tokens.accessToken;
    } catch (error: unknown) {
      clear();
      throw error;
    }
  }

  async function logout(): Promise<void> {
    const { $api } = useNuxtApp();
    try {
      await $api.post('/auth/logout', undefined);
    } finally {
      clear();
      await navigateTo('/auth/login');
    }
  }

  return {
    accessToken,
    refreshToken,
    profile,
    actor,
    isAuthenticated,
    isSystemAdmin,
    isWorkspaceAdmin,
    hasPermission,
    setTokens,
    setProfile,
    setActor,
    clear,
    onAccessTokenExpired,
    completeAuthentication,
    refreshTokens,
    fetchProfile,
    logout,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
