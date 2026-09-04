<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { WorkspaceSummary } from '@weave/types';
import { computed } from '#imports';

type WorkspaceOption = Pick<WorkspaceSummary, 'id' | 'name' | 'slug'>;

const props = defineProps<{
  workspaces: WorkspaceOption[];
  collapsed?: boolean;
}>();

const workspaceId = defineModel<number>('workspaceId', { required: true });

const currentWorkspace = computed(() => (
  props.workspaces.find((workspace) => workspace.id === workspaceId.value)
  ?? props.workspaces[0]
));

const workspaceItems = computed<DropdownMenuItem[][]>(() => [
  [{
    label: 'Switch workspace',
    type: 'label',
  }],
  props.workspaces.map((workspace) => ({
    label: workspace.name,
    icon: 'i-solar-buildings-3-bold-duotone',
    trailingIcon: workspace.id === workspaceId.value
      ? 'i-solar-check-circle-bold-duotone'
      : undefined,
    onSelect: () => {
      workspaceId.value = workspace.id;
    },
  })),
]);
</script>

<template>
  <UDropdownMenu
    :items="workspaceItems"
    :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
    :portal="false"
    :ui="{
      content: 'z-50 w-68 rounded-lg bg-default shadow-xl ring-1 ring-default',
    }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      :block="!collapsed"
      class="group rounded-xl active:translate-y-px"
      :class="collapsed
        ? 'size-14 justify-center'
        : 'min-h-16 border border-default px-2.5 text-left'"
      :ui="{
        base: 'justify-start transition-transform duration-200',
      }"
      :aria-label="collapsed
        ? `Switch workspace, current workspace: ${currentWorkspace?.name ?? 'none'}`
        : 'Switch workspace'"
    >
      <UIcon
        v-if="collapsed"
        name="i-solar-buildings-3-bold-duotone"
        class="size-5 shrink-0 text-primary"
      />

      <span
        v-else
        class="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10
          text-primary ring-1 ring-primary/20"
      >
        <UIcon
          name="i-solar-buildings-3-bold-duotone"
          class="size-5"
        />
      </span>

      <span
        v-if="!collapsed"
        class="min-w-0 flex-1"
      >
        <span class="block truncate text-sm font-semibold text-highlighted">
          {{ currentWorkspace?.name ?? 'Select workspace' }}
        </span>
        <span class="mt-0.5 block truncate text-xs text-muted">
          {{ currentWorkspace ? `@${currentWorkspace.slug}` : 'No workspace available' }}
        </span>
      </span>

      <UIcon
        v-if="!collapsed"
        name="i-solar-alt-arrow-down-bold-duotone"
        class="size-4 shrink-0 text-dimmed transition-colors group-hover:text-highlighted"
      />
    </UButton>
  </UDropdownMenu>
</template>
