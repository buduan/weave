<script setup lang="ts">
import type { MailPublicConfig } from '@orz-people-platform/types';
import {
  definePageMeta, onMounted, shallowRef, useNuxtApp,
} from '#imports';
import { ApiError } from '~/utils/api';

definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  requiresAuth: true,
});

const { $api } = useNuxtApp();

const accessDenied = shallowRef(false);
const configured = shallowRef(false);
const url = shallowRef('');
const loading = shallowRef(true);
const saving = shallowRef(false);
const saveMessage = shallowRef('');
const saveError = shallowRef('');

onMounted(async () => {
  try {
    const config = await $api.get<MailPublicConfig>('/mail/config');
    configured.value = config.configured;
    url.value = config.url;
  } catch (error: unknown) {
    // 403 表示后端（权威判定）认为该账号不是系统管理员。
    if (error instanceof ApiError && error.httpStatus === 403) {
      accessDenied.value = true;
    } else {
      saveError.value = error instanceof Error ? error.message : '加载配置失败';
    }
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  saving.value = true;
  saveMessage.value = '';
  saveError.value = '';
  try {
    const config = await $api.put<MailPublicConfig>('/mail/config', { url: url.value.trim() });
    configured.value = config.configured;
    url.value = config.url;
    saveMessage.value = '已保存。';
  } catch (error: unknown) {
    saveError.value = error instanceof Error ? error.message : '保存失败';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="border-b border-accented pb-7">
      <div class="flex flex-wrap items-center gap-3">
        <UBadge
          label="Administration"
          color="primary"
          variant="subtle"
          size="sm"
        />
        <code class="text-xs font-semibold text-muted">
          /settings
        </code>
      </div>
      <h1 class="mt-4 text-3xl font-bold tracking-[-0.035em] text-highlighted sm:text-4xl">
        Settings
      </h1>
      <p class="mt-3 max-w-2xl text-base leading-7 text-muted">
        管理站点级配置。当前提供 Power Automate 邮件通道，用于发送邮箱验证码等通知。
      </p>
    </header>

    <template v-if="accessDenied">
      <UCard class="rounded-3xl border-default bg-default shadow-sm">
        <div class="flex items-start gap-4">
          <span
            class="grid size-10 shrink-0 place-items-center rounded-xl bg-elevated text-muted"
          >
            <UIcon
              name="i-solar-lock-keyhole-minimalistic-bold-duotone"
              class="size-5"
            />
          </span>
          <div>
            <h2 class="text-sm font-bold text-highlighted">
              需要系统管理员权限
            </h2>
            <p class="mt-1 text-sm leading-6 text-muted">
              站点设置仅对系统管理员开放。请联系管理员调整你的权限。
            </p>
          </div>
        </div>
      </UCard>
    </template>

    <template v-else>
      <UCard
        class="rounded-3xl border-default bg-default shadow-sm"
        :ui="{ body: 'space-y-5' }"
      >
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-sm font-bold text-highlighted">
                Power Automate 邮件
              </p>
              <p class="mt-1 text-xs text-muted">
                配置触发器为「当收到 HTTP 请求时」的 Power Automate 流 URL
              </p>
            </div>
            <UBadge
              :label="configured ? '已配置' : '未配置'"
              :color="configured ? 'success' : 'neutral'"
              :variant="configured ? 'subtle' : 'outline'"
              size="sm"
            />
          </div>
        </template>

        <div
          v-if="loading"
          class="flex items-center gap-2 text-sm text-muted"
        >
          <UIcon
            name="i-solar-refresh-circle-bold-duotone"
            class="size-4 motion-safe:animate-spin"
          />
          正在加载配置…
        </div>

        <form
          v-else
          class="space-y-5"
          @submit.prevent="save"
        >
          <UFormField
            label="Webhook URL"
            name="power-automate-url"
            :error="saveError || undefined"
            hint="留空可清空配置并停用邮件发送"
          >
            <UInput
              v-model="url"
              type="url"
              placeholder="https://prod-xx.westus.logic.azure.com:443/workflows/..."
              autocomplete="off"
              size="xl"
              class="w-full"
            />
          </UFormField>

          <div class="flex flex-wrap items-center gap-3">
            <UButton
              type="submit"
              label="保存"
              icon="i-solar-diskette-bold-duotone"
              :loading="saving"
            />
            <span
              v-if="saveMessage"
              class="inline-flex items-center gap-1.5 text-sm text-primary"
            >
              <UIcon
                name="i-solar-check-circle-bold-duotone"
                class="size-4"
              />
              {{ saveMessage }}
            </span>
          </div>

          <p class="rounded-xl bg-elevated p-4 text-xs leading-6 text-muted">
            请求体格式为
            <code class="font-mono text-toned">{ email, subject, content }</code>。
            验证码等通知会通过此 URL 以 JSON POST 发出。
          </p>
        </form>
      </UCard>
    </template>
  </div>
</template>
