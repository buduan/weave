<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- skeleton keys use the loop index */
import {
  computed,
  definePageMeta,
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
import { canSubmitPublishedForm } from '~/utils/form-lifecycle';
import { formatFormLocale, orderFormLocales } from '~/utils/form-locales';
import {
  prepareFormSubmissionAttempt,
  type FormSubmissionAttempt,
} from '~/utils/form-submission-idempotency';

definePageMeta({
  inlineAuth: true,
  layout: false,
});

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

const locale = shallowRef('zh-CN');
const submissionPending = shallowRef(false);
const submitError = shallowRef<string | null>(null);
const submitted = shallowRef<SubmitFormResult | null>(null);
const attempt = shallowRef<FormSubmissionAttempt | null>(null);
const switchingAccount = shallowRef(false);
let formGeneration = 0;

watch(formId, () => {
  formGeneration += 1;
  submissionPending.value = false;
  submitError.value = null;
  submitted.value = null;
  attempt.value = null;
});

watch(
  () => [form.value?.id, form.value?.version],
  () => {
    if (form.value) locale.value = form.value.defaultLocale;
  },
  { immediate: true },
);

const notFound = computed(() => {
  const current = loadError.value as unknown as {
    httpStatus?: number;
    statusCode?: number;
    status?: number;
  } | null;
  return current?.httpStatus === 404 || current?.statusCode === 404 || current?.status === 404;
});
const pageTitle = computed(() => resolveLocalizedText(
  form.value?.nameI18n,
  locale.value,
  form.value?.defaultLocale,
) ?? '填写表单');
const pageDescription = computed(() => resolveLocalizedText(
  form.value?.descriptionI18n ?? undefined,
  locale.value,
  form.value?.defaultLocale,
));
const closingMessage = computed(() => resolveLocalizedText(
  form.value?.closingMessageI18n ?? undefined,
  locale.value,
  form.value?.defaultLocale,
) ?? '提交成功，感谢你的填写。');
const localeItems = computed(() => {
  if (!form.value) return [];
  return orderFormLocales(
    form.value.defaultLocale,
    Object.keys(form.value.nameI18n),
  ).map((value) => ({
    label: formatFormLocale(value),
    value,
  }));
});
const requiresAuthentication = computed(() => (
  form.value?.submissionAccess === 'authentication_required'
));
const needsAuthentication = computed(() => (
  requiresAuthentication.value && !authStore.isAuthenticated
));
const formFillingKey = computed(() => (form.value
  ? `${form.value.id}:${form.value.version}:${form.value.submissionContext?.expectedRevision ?? 'create'}`
  : 'empty'
));
const accountName = computed(() => (
  authStore.profile?.name
  || authStore.profile?.nickname
  || authStore.profile?.username
  || authStore.profile?.email
  || '当前账号'
));
const unavailableCopy = computed<[string, string]>(() => {
  const copies = {
    not_started: ['尚未开放', '这个表单还没有开始收集回答，请稍后再来。'],
    closed: ['填写已结束', '这个表单目前不再接收新的回答。'],
    inactive: ['暂不可用', '表单所使用的数据集当前不可用。'],
    subject_row_missing: ['没有可更新的资料', '你的账号尚未关联到这个表单所需的资料行。'],
    configuration_invalid: ['配置暂不可用', '表单当前的字段或选项配置无效，请联系管理员。'],
  } satisfies Record<NonNullable<PublishedFormDefinition['unavailableReason']>, [string, string]>;
  return copies[form.value?.unavailableReason ?? 'closed'];
});

useHead({ title: pageTitle });

onMounted(async () => {
  if (loadError.value && !notFound.value) await refresh();
  if (authStore.isAuthenticated && !authStore.profile) {
    try {
      await authStore.fetchProfile();
    } catch {
      // Keep the fill page usable; the backend still verifies the authenticated actor.
    }
  }
});

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
  if (
    submissionPending.value
    || needsAuthentication.value
    || !canSubmitPublishedForm(form.value)
  ) return;
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

async function authenticated(): Promise<void> {
  submitError.value = null;
  await refresh();
}

async function switchAccount(): Promise<void> {
  if (switchingAccount.value) return;
  switchingAccount.value = true;
  try {
    await authStore.logout({ redirectTo: false });
  } catch {
    // Local credentials are cleared in all cases, so the inline flow can continue.
  } finally {
    switchingAccount.value = false;
  }
  await refresh();
}
</script>

<template>
  <main class="min-h-dvh overflow-x-hidden bg-muted text-default">
    <div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10 lg:py-14">
      <template v-if="status === 'pending'">
        <section
          class="rounded-2xl border border-default/70 bg-default px-6 py-10 text-center
            shadow-sm shadow-neutral-950/5 sm:px-10"
          role="status"
          aria-live="polite"
          aria-label="正在加载表单"
        >
          <USkeleton class="mx-auto h-9 w-2/5" />
          <USkeleton class="mx-auto mt-4 h-5 w-3/5" />
        </section>
        <section
          class="mt-4 rounded-2xl border border-default/70 bg-default p-5 shadow-sm
            shadow-neutral-950/5 sm:p-8"
        >
          <div
            v-for="index in 3"
            :key="index"
            class="mb-7 last:mb-0"
          >
            <USkeleton class="h-5 w-36" />
            <USkeleton class="mt-3 h-11 w-full" />
          </div>
        </section>
        <span class="sr-only">正在加载表单…</span>
      </template>

      <section
        v-else-if="loadError"
        class="rounded-2xl border border-default/70 bg-default px-6 py-12 text-center
          shadow-sm shadow-neutral-950/5 sm:px-10 sm:py-16"
        role="alert"
      >
        <UIcon
          :name="notFound
            ? 'i-solar-document-text-bold-duotone'
            : 'i-solar-cloud-cross-bold-duotone'"
          class="mx-auto size-11 text-muted"
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

      <template v-else-if="form">
        <section
          :lang="locale"
          class="rounded-2xl border border-default/70 bg-default px-6 py-9 text-center
            shadow-sm shadow-neutral-950/5 sm:px-10 sm:py-11"
        >
          <div
            v-if="localeItems.length > 1"
            class="mb-6 flex justify-center"
          >
            <USelect
              id="form-language"
              v-model="locale"
              :items="localeItems"
              class="min-h-11 w-44 text-left"
              aria-label="选择填写语言"
            />
          </div>
          <h1 class="text-3xl font-bold tracking-[-0.035em] text-highlighted sm:text-4xl">
            {{ pageTitle }}
          </h1>
          <p
            v-if="pageDescription"
            class="mx-auto mt-4 max-w-[58ch] whitespace-pre-line text-base leading-7 text-muted"
          >
            {{ pageDescription }}
          </p>
        </section>

        <section
          v-if="form.acceptingSubmissions && requiresAuthentication"
          class="mt-4 rounded-2xl border border-default/70 bg-default p-5 shadow-sm
            shadow-neutral-950/5 sm:p-8"
        >
          <FormAuthentication
            v-if="needsAuthentication"
            :redirect="route.fullPath"
            @authenticated="authenticated"
          />

          <div
            v-else
            class="flex min-h-11 flex-col justify-between gap-4 sm:flex-row sm:items-center"
            role="status"
          >
            <p class="text-sm font-medium text-highlighted sm:text-base">
              将会以 <span class="font-bold">{{ accountName }}</span> 的身份作答
            </p>
            <UButton
              type="button"
              color="primary"
              variant="link"
              class="min-h-11 self-start px-0 sm:self-auto"
              :loading="switchingAccount"
              :disabled="switchingAccount"
              @click="switchAccount"
            >
              更换账号
            </UButton>
          </div>
        </section>

        <section
          v-if="submitted"
          class="mt-4 rounded-2xl border border-default/70 bg-default px-6 py-14 text-center
            shadow-sm shadow-neutral-950/5 sm:px-10 sm:py-16"
          role="status"
          aria-live="polite"
        >
          <div
            class="mx-auto grid size-12 place-items-center rounded-full bg-success/10 text-success"
          >
            <UIcon
              name="i-solar-check-circle-bold-duotone"
              class="size-7"
              aria-hidden="true"
            />
          </div>
          <h2 class="mt-5 text-2xl font-bold tracking-tight text-highlighted">
            已收到你的回答
          </h2>
          <p class="mx-auto mt-3 max-w-[52ch] whitespace-pre-line leading-7 text-muted">
            {{ closingMessage }}
          </p>
        </section>

        <section
          v-else-if="!form.acceptingSubmissions"
          class="mt-4 rounded-2xl border border-default/70 bg-default p-5 shadow-sm
            shadow-neutral-950/5 sm:p-8"
          role="status"
          aria-live="polite"
        >
          <UAlert
            icon="i-solar-info-circle-bold-duotone"
            color="warning"
            variant="subtle"
            :title="unavailableCopy[0]"
            :description="unavailableCopy[1]"
          />
        </section>

        <section
          v-else
          class="mt-4 rounded-2xl border border-default/70 bg-default p-5 shadow-sm
            shadow-neutral-950/5 sm:p-8"
        >
          <FormFilling
            :key="formFillingKey"
            :form="form"
            :locale="locale"
            :authenticated-email="authStore.profile?.email ?? null"
            :pending="submissionPending"
            :submit-error="submitError"
            :submit-disabled="needsAuthentication"
            :load-relation-options="loadRelationOptions"
            @submit="submit"
          />
        </section>
      </template>
    </div>
  </main>
</template>
