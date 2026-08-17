<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui';
import type { WorkspaceSummary } from '@weave/types';

import { useAuthStore } from '~/stores/auth';
import { computed, shallowRef, useState } from '#imports';

const authStore = useAuthStore();
const mobileNavigationOpen = shallowRef(false);
const desktopSidebarCollapsed = shallowRef(false);
const workspaceId = useState<number>('dashboard-workspace-id', () => 1);

const workspaces: Pick<WorkspaceSummary, 'id' | 'name' | 'slug'>[] = [{
  id: 1,
  name: 'Default Workspace',
  slug: 'default',
}];

const navigation: NavigationMenuItem[] = [
  {
    label: 'Workspace',
    type: 'label',
  },
  {
    label: 'Overview',
    icon: 'i-solar-widget-5-bold-duotone',
    to: '/dashboard',
  },
  {
    label: 'People',
    icon: 'i-solar-users-group-rounded-bold-duotone',
    to: '/people',
  },
  {
    label: 'Organization',
    icon: 'i-solar-buildings-2-bold-duotone',
    to: '/organization',
  },
  {
    label: '数据表',
    icon: 'i-solar-database-bold-duotone',
    to: '/panel/dataset',
  },
  {
    label: 'Forms',
    icon: 'i-solar-notes-bold-duotone',
    to: '/panel/form',
  },
  {
    label: 'Administration',
    type: 'label',
  },
  {
    label: 'Roles & access',
    icon: 'i-solar-shield-user-bold-duotone',
    to: '/access',
  },
  {
    label: 'Settings',
    icon: 'i-solar-settings-minimalistic-bold-duotone',
    to: '/settings',
  },
];

const userRole = computed(() => {
  if (authStore.isSystemAdmin) return 'System administrator';
  if (authStore.isWorkspaceAdmin) return 'Workspace administrator';
  return 'Workspace member';
});

const user = computed(() => ({
  name: authStore.profile?.name
    || authStore.profile?.nickname
    || authStore.profile?.username
    || 'Signed-in user',
  email: authStore.profile?.email ?? '',
  avatarUrl: authStore.profile?.avatarUrl ?? null,
  role: userRole.value,
}));

function openMobileNavigation(): void {
  mobileNavigationOpen.value = true;
}

function closeMobileNavigation(): void {
  mobileNavigationOpen.value = false;
}

async function logout(): Promise<void> {
  await authStore.logout();
}
</script>

<template>
  <div
    class="min-h-[100dvh] bg-muted motion-safe:transition-[grid-template-columns]
      motion-safe:duration-300 motion-safe:ease-in-out lg:grid"
    :class="desktopSidebarCollapsed
      ? 'lg:grid-cols-[5rem_minmax(0,1fr)]'
      : 'lg:grid-cols-[18rem_minmax(0,1fr)]'"
  >
    <aside class="sticky top-0 hidden h-[100dvh] lg:block">
      <DashboardSidebar
        v-model:collapsed="desktopSidebarCollapsed"
        v-model:workspace-id="workspaceId"
        :navigation="navigation"
        :workspaces="workspaces"
        :user="user"
        collapsible
        @logout="logout"
      />
    </aside>

    <div class="min-w-0">
      <header
        class="sticky top-0 z-20 flex h-16 items-center justify-between border-b
          border-default bg-default/90 px-4 backdrop-blur lg:hidden"
      >
        <div class="flex items-center gap-2.5">
          <span
            class="grid size-8 place-items-center rounded-xl bg-primary/10 text-[0.625rem]
              font-black tracking-[0.08em] text-primary ring-1 ring-primary/20"
          >
            ORZ
          </span>
          <span class="text-sm font-bold tracking-tight text-highlighted">
            People Platform
          </span>
        </div>
        <UButton
          icon="i-solar-sidebar-minimalistic-bold-duotone"
          color="neutral"
          variant="ghost"
          square
          class="rounded-xl text-muted hover:bg-elevated active:translate-y-px"
          aria-label="Open navigation"
          @click="openMobileNavigation"
        />
      </header>

      <main
        id="dashboard-content"
        class="dashboard-canvas min-h-[100dvh] lg:min-h-0 lg:h-[100dvh] lg:overflow-hidden"
      >
        <div class="mx-auto w-full max-w-[92rem] lg:h-full">
          <slot />
        </div>
      </main>
    </div>

    <USlideover
      v-model:open="mobileNavigationOpen"
      side="left"
      title="Dashboard navigation"
      :close="false"
      :ui="{
        overlay: 'bg-black/20 backdrop-blur-sm',
        content: 'w-[19rem] max-w-[88vw] bg-default ring-0',
      }"
    >
      <template #content>
        <DashboardSidebar
          v-model:workspace-id="workspaceId"
          :navigation="navigation"
          :workspaces="workspaces"
          :user="user"
          closable
          @close="closeMobileNavigation"
          @logout="logout"
          @navigate="closeMobileNavigation"
        />
      </template>
    </USlideover>
  </div>
</template>
