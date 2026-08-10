<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- skeleton keys use the loop index */
import {
  computed,
  definePageMeta,
  navigateTo,
  onMounted,
  shallowRef,
  useAsyncData,
  useHead,
  useNuxtApp,
  useRoute,
  watch,
} from '#imports';
import type {
  FormRelationOption,
  JsonValue,
  PublishedFormDefinition,
  SubmitFormRequest,
  SubmitFormResult,
} from '@weave/types';
import { resolveLocalizedText } from '@weave/utils';

import { useAuthStore } from '~/stores/auth';
import { toApiError } from '~/utils/api';
import {
  canSubmitPublishedForm,
} from '~/utils/form-lifecycle';
import {
  prepareFormSubmissionAttempt,
  type FormSubmissionAttempt,
} from '~/utils/form-submission-idempotency';

definePageMeta({ layout: false });

const route = useRoute();
const { $api } = useNuxtApp();
const authStore = useAuthStore();
const formId = computed(() => String(route.params.id ?? ''));
const authMode = computed<'access' | 'none'>(() => (
  authStore.isAuthenticated ? 'access' : 'none'
));
const asyncDataKey = computed(() => `published-form:${formId.value}:${authMode.value}`);

const {
  data: form,
  error: loadError,
  refresh,
  status,
} = await useAsyncData(
  asyncDataKey,
  () => $api.get<PublishedFormDefinition>(
    `/forms/getPublishedForm/${encodeURIComponent(formId.value)}`,
    { auth: authMode.value },
  ),
);

const submissionPending = shallowRef(false);
const submitError = shallowRef<string | null>(null);
const submitted = shallowRef<SubmitFormResult | null>(null);
const attempt = shallowRef<FormSubmissionAttempt | null>(null);
let formGeneration = 0;

watch(formId, () => {
  formGeneration += 1;
  submissionPending.value = false;
  submitError.value = null;
  submitted.value = null;
  attempt.value = null;
});

const notFound = computed(() => {
  const current = loadError.value as unknown as {
    httpStatus?: number;
    statusCode?: number;
    status?: number;
  } | null;
  return current?.httpStatus === 404 || current?.statusCode === 404 || current?.status === 404;
});

onMounted(async () => {
  if (loadError.value && !notFound.value) await refresh();
});

const pageTitle = computed(() => resolveLocalizedText(
  form.value?.nameI18n,
  form.value?.defaultLocale,
  form.value?.defaultLocale,
) ?? '填写表单');

useHead({ title: pageTitle });

async function loadRelationOptions(
  itemId: string,
  answers: Readonly<Record<string, JsonValue>>,
): Promise<FormRelationOption[]> {
  const query = new URLSearchParams({
    values: JSON.stringify(answers),
    take: '100',
  });
  return $api.get<FormRelationOption[]>(
    `/forms/getRelationOptions/${encodeURIComponent(formId.value)}/${encodeURIComponent(itemId)}?${query}`,
    { auth: 'none' },
  );
}

function submissionErrorMessage(error: unknown): string {
  const apiError = toApiError(error);
  if (apiError.httpStatus === 409) return '表单状态或资料版本已经变化，请刷新页面后再试。';
  if (apiError.httpStatus === 429) return '提交次数过多，请稍后再试。';
  if (apiError.httpStatus === 401) return '登录状态已失效，请重新登录后继续。';
  if (apiError.httpStatus === 400) return '部分回答未通过服务器校验，请检查后再试。';
  return apiError.httpStatus === 0 ? '网络连接失败，请保持当前回答并重试。' : apiError.message;
}

async function submit(payload: Omit<SubmitFormRequest, 'formId'>): Promise<void> {
  if (submissionPending.value || !canSubmitPublishedForm(form.value)) return;
  const generation = formGeneration;
  attempt.value = prepareFormSubmissionAttempt(
    attempt.value,
    payload,
    () => crypto.randomUUID(),
  );
  submissionPending.value = true;
  submitError.value = null;
  try {
    const result = await $api.post<SubmitFormResult>(
      '/forms/submitForm',
      { formId: formId.value, ...payload },
      {
        auth: authMode.value,
        headers: { 'Idempotency-Key': attempt.value.key },
      },
    );
    if (generation !== formGeneration) return;
    submitted.value = result;
    attempt.value = null;
  } catch (error: unknown) {
    if (generation === formGeneration) submitError.value = submissionErrorMessage(error);
  } finally {
    if (generation === formGeneration) submissionPending.value = false;
  }
}

async function login(): Promise<void> {
  await navigateTo({
    path: '/auth/login',
    query: { redirect: route.fullPath },
  });
}
</script>

<template>
  <main class="min-h-[100dvh] overflow-x-hidden bg-muted text-default">
    <div class="h-1 bg-primary" />
    <div class="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
      <div class="mb-6 flex items-center justify-between gap-4 px-1">
        <NuxtLink
          to="/"
          class="inline-flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-bold
            tracking-tight text-highlighted outline-none focus-visible:ring-2
            focus-visible:ring-primary"
        >
          <span
            class="grid size-8 place-items-center rounded-lg bg-primary/10 text-[0.625rem]
              font-black tracking-[0.08em] text-primary ring-1 ring-primary/20"
          >
            ORZ
          </span>
          People Platform
        </NuxtLink>
        <span class="text-xs font-medium uppercase tracking-[0.14em] text-muted">
          Secure form
        </span>
      </div>

      <section
        v-if="status === 'pending'"
        class="rounded-[1.75rem] border border-default bg-default p-6 shadow-xl
          shadow-neutral-950/5 sm:p-9"
        role="status"
        aria-live="polite"
        aria-label="正在加载表单"
      >
        <USkeleton class="h-3 w-28" />
        <USkeleton class="mt-6 h-10 w-3/4" />
        <USkeleton class="mt-4 h-5 w-full max-w-xl" />
        <div class="mt-10 space-y-6 border-t border-default pt-8">
          <div
            v-for="index in 3"
            :key="index"
          >
            <USkeleton class="h-5 w-40" />
            <USkeleton class="mt-3 h-11 w-full" />
          </div>
        </div>
        <span class="sr-only">正在加载表单…</span>
      </section>

      <section
        v-else-if="loadError"
        class="rounded-[1.75rem] border border-default bg-default px-6 py-12 text-center
          shadow-xl shadow-neutral-950/5 sm:px-10 sm:py-16"
        role="alert"
      >
        <UIcon
          :name="notFound
            ? 'i-solar-document-text-bold-duotone'
            : 'i-solar-cloud-cross-bold-duotone'"
          class="mx-auto size-12 text-muted"
          aria-hidden="true"
        />
        <h1 class="mt-5 text-2xl font-bold tracking-tight text-highlighted">
          {{ notFound ? '没有找到这个表单' : '表单加载失败' }}
        </h1>
        <p class="mx-auto mt-3 max-w-md leading-7 text-muted">
          {{ notFound
            ? '链接可能已经失效，或者这个表单还没有发布。'
            : '暂时无法取得表单内容，请检查网络连接后重试。' }}
        </p>
        <UButton
          v-if="!notFound"
          class="mt-6 min-h-11 active:translate-y-px"
          color="neutral"
          variant="outline"
          icon="i-solar-refresh-bold-duotone"
          @click="refresh()"
        >
          重新加载
        </UButton>
      </section>

      <FormFilling
        v-else-if="form"
        :key="`${form.id}:${form.version}:${form.submissionContext?.expectedRevision ?? 'create'}`"
        :form="form"
        :authenticated="authStore.isAuthenticated"
        :pending="submissionPending"
        :submit-error="submitError"
        :submitted="submitted"
        :load-relation-options="loadRelationOptions"
        @login="login"
        @submit="submit"
      />

      <footer class="px-2 pt-8 text-center text-xs leading-5 text-muted">
        你的回答会通过安全连接提交。请勿在共享设备上保留敏感信息。
      </footer>
    </div>
  </main>
</template>
