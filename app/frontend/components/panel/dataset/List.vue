<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- False positives for Vue template-scoped aliases. */
import type {
  ArchiveDatasetRequest,
  CreateDatasetRequest,
  DatasetListItem,
  DatasetListResponse,
  DatasetSummary,
} from '@weave/types';
import {
  computed, onMounted, shallowRef, useNuxtApp, useRouter, useState,
} from '#imports';
import { toApiError } from '~/utils/api';
import { getDatasetEditorPath } from './editor-state';

const { $api } = useNuxtApp();
const router = useRouter();
const workspaceId = useState<number>('dashboard-workspace-id', () => 1);
const state = shallowRef<'error' | 'loading' | 'success'>('loading');
const data = shallowRef<DatasetListResponse>({ items: [], canCreate: false });
const error = shallowRef('');
const createOpen = shallowRef(false);
const createPending = shallowRef(false);
const createError = shallowRef<string | null>(null);
const archiveTarget = shallowRef<DatasetListItem | null>(null);
const archivePending = shallowRef(false);
const archiveError = shallowRef<string | null>(null);

const listUrl = computed(() => `/workspaces/${workspaceId.value}/datasets`);

async function load(): Promise<void> {
  state.value = 'loading';
  error.value = '';
  try {
    data.value = await $api.get<DatasetListResponse>(listUrl.value);
    state.value = 'success';
  } catch (cause) {
    error.value = toApiError(cause).message;
    state.value = 'error';
  }
}

async function createDataset(input: CreateDatasetRequest): Promise<void> {
  createPending.value = true;
  createError.value = null;
  try {
    const dataset = await $api.post<DatasetSummary>(listUrl.value, input);
    createOpen.value = false;
    await router.push(getDatasetEditorPath(dataset.id));
  } catch (cause) {
    createError.value = toApiError(cause).message;
  } finally {
    createPending.value = false;
  }
}

async function archiveDataset(): Promise<void> {
  const target = archiveTarget.value;
  if (!target) return;
  archivePending.value = true;
  archiveError.value = null;
  try {
    await $api.post<DatasetSummary>(`${listUrl.value}/${target.id}/archive`, {
      expectedRevision: target.revision,
    } satisfies ArchiveDatasetRequest);
    archiveTarget.value = null;
    await load();
  } catch (cause) {
    const apiError = toApiError(cause);
    archiveError.value = apiError.httpStatus === 409
      ? '数据表已被其他操作更新，请刷新列表后重试。'
      : apiError.message;
  } finally {
    archivePending.value = false;
  }
}

function typeLabel(type: DatasetListItem['type']): string {
  return {
    standard: '标准',
    members: '成员',
    join_requests: '加入申请',
    activity_registrations: '活动报名',
  }[type];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value));
}

onMounted(load);
</script>

<template>
  <div class="mx-auto w-full max-w-360 px-4 py-6 sm:px-8 lg:px-12">
    <PanelCommonNavigation />

    <main class="mt-8">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
            数据表管理
          </h1>
          <p class="mt-1.5 text-sm text-muted">
            管理工作区中的结构化数据与字段定义。
          </p>
        </div>
        <UButton
          v-if="data.canCreate"
          label="新建数据表"
          icon="i-solar-add-circle-bold-duotone"
          color="neutral"
          @click="createError = null; createOpen = true"
        />
      </header>

      <div
        v-if="state === 'loading'"
        class="grid min-h-72 place-items-center"
        aria-label="正在加载数据表"
      >
        <UIcon
          name="i-solar-refresh-bold-duotone"
          class="size-7 animate-spin text-primary"
        />
      </div>

      <div
        v-else-if="state === 'error'"
        class="grid min-h-72 place-items-center p-8 text-center"
        role="alert"
      >
        <div>
          <UIcon
            name="i-solar-danger-triangle-bold-duotone"
            class="size-8 text-error"
          />
          <p class="mt-3 text-sm text-muted">
            {{ error }}
          </p>
          <UButton
            class="mt-4"
            label="重试"
            color="neutral"
            @click="load"
          />
        </div>
      </div>

      <div
        v-else-if="data.items.length === 0"
        class="grid min-h-72 place-items-center p-8 text-center"
      >
        <div>
          <UIcon
            name="i-solar-database-bold-duotone"
            class="size-10 text-dimmed"
          />
          <h2 class="mt-3 font-medium text-highlighted">
            还没有可见的数据表
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ data.canCreate ? '创建第一张数据表开始整理数据。' : '请联系管理员授予访问权限。' }}
          </p>
        </div>
      </div>

      <div
        v-else
        class="overflow-x-auto"
      >
        <table class="w-full min-w-208 text-left text-sm">
          <thead class="border-b border-default text-xs font-medium text-dimmed">
            <tr>
              <th class="px-3 py-3">
                数据表
              </th>
              <th class="px-3 py-3">
                类型
              </th>
              <th class="px-3 py-3">
                状态
              </th>
              <th class="px-3 py-3">
                更新时间
              </th>
              <th class="px-3 py-3 text-right">
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default/70">
            <!-- eslint-disable-next-line vue/valid-v-for -->
            <tr
              v-for="dataset in data.items"
              :key="dataset.id"
              class="group transition-colors hover:bg-elevated/40"
            >
              <td class="px-3 py-4">
                <NuxtLink
                  :to="getDatasetEditorPath(dataset.id)"
                  class="block min-w-0 rounded-sm focus-visible:outline-2
                    focus-visible:outline-primary"
                >
                  <span
                    class="block truncate font-medium text-highlighted group-hover:text-primary"
                  >
                    {{ dataset.name }}
                  </span>
                  <span class="mt-0.5 block truncate font-mono text-xs text-muted">
                    {{ dataset.slug }} · {{ dataset.creator.displayName }}
                  </span>
                </NuxtLink>
              </td>
              <td class="px-3 py-4 text-toned">
                {{ typeLabel(dataset.type) }}
              </td>
              <td class="px-3 py-4">
                <UBadge
                  :label="dataset.status === 'active' ? '使用中' : '已归档'"
                  :color="dataset.status === 'active' ? 'success' : 'neutral'"
                  variant="subtle"
                />
              </td>
              <td class="px-3 py-4 text-muted">
                {{ formatDate(dataset.updatedAt) }}
              </td>
              <td class="px-3 py-4 text-right">
                <UDropdownMenu
                  :items="[[
                    {
                      label: '打开',
                      icon: 'i-solar-arrow-right-up-linear',
                      onSelect: () => router.push(getDatasetEditorPath(dataset.id)),
                    },
                    ...(dataset.capabilities.canArchive ? [{
                      label: '归档',
                      icon: 'i-solar-archive-down-bold-duotone',
                      color: 'error' as const,
                      onSelect: () => { archiveError = null; archiveTarget = dataset; },
                    }] : []),
                  ]]"
                >
                  <UButton
                    icon="i-solar-menu-dots-bold-duotone"
                    color="neutral"
                    variant="ghost"
                    square
                    :aria-label="`操作：${dataset.name}`"
                  />
                </UDropdownMenu>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>

    <PanelDatasetDefinitionDialog
      v-model:open="createOpen"
      :pending="createPending"
      :error="createError"
      @submit="createDataset"
    />

    <UModal
      :open="archiveTarget !== null"
      title="归档数据表"
      :description="archiveTarget ? `归档“${archiveTarget.name}”后将无法继续修改数据。` : ''"
      :dismissible="!archivePending"
      @update:open="!$event && !archivePending ? archiveTarget = null : undefined"
    >
      <template #body>
        <UAlert
          v-if="archiveError"
          color="error"
          variant="subtle"
          title="归档失败"
          :description="archiveError"
        />
        <p
          v-else
          class="text-sm text-toned"
        >
          历史数据仍会保留并可读取。
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            :disabled="archivePending"
            @click="archiveTarget = null"
          />
          <UButton
            label="确认归档"
            color="error"
            :loading="archivePending"
            @click="archiveDataset"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
