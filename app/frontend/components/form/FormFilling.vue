<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- runtime keys use localized validation messages */
import {
  computed,
  ref,
  watch,
} from '#imports';
import type {
  FormItemId,
  JsonValue,
  PublishedFormDefinition,
  SubmitFormRequest,
  SubmitFormResult,
} from '@weave/types';
import {
  cloneJson,
  evaluateFormAnswers,
  parseFormSchema,
  resolveLocalizedText,
} from '@weave/utils';

import {
  formatFormLocale,
  orderFormLocales,
} from '~/utils/form-locales';
import { validateFormFilling } from '~/utils/form-filling-validation';
import type { FormRenderContext } from './types';

const props = defineProps<{
  authenticated: boolean;
  form: PublishedFormDefinition;
  loadRelationOptions?: FormRenderContext['loadRelationOptions'];
  pending?: boolean;
  submitError?: string | null;
  submitted?: SubmitFormResult | null;
}>();

const emit = defineEmits<{
  login: [];
  submit: [payload: Omit<SubmitFormRequest, 'formId'>];
}>();

const answers = ref<Record<FormItemId, JsonValue | undefined>>({});
const locale = ref(props.form.defaultLocale);
const fieldErrors = ref<Record<FormItemId, string>>({});
const formErrors = ref<string[]>([]);

function resetFillingState(): void {
  const inputAnswers = cloneJson(props.form.submissionContext?.answers ?? {});
  const parsed = parseFormSchema(props.form.schema, { mode: 'legacy' });
  answers.value = evaluateFormAnswers({
    parsed,
    runtimeSchema: parsed.schema,
    inputAnswers,
    rejectExplicitHidden: false,
  }).answers;
  locale.value = props.form.defaultLocale;
  fieldErrors.value = {};
  formErrors.value = [];
}

watch(
  () => [
    props.form.id,
    props.form.version,
    props.form.submissionContext?.expectedRevision,
  ],
  resetFillingState,
  { immediate: true },
);

watch(answers, () => {
  if (Object.keys(fieldErrors.value).length > 0) fieldErrors.value = {};
  if (formErrors.value.length > 0) formErrors.value = [];
}, { deep: true });

const locales = computed(() => orderFormLocales(
  props.form.defaultLocale,
  Object.keys(props.form.nameI18n),
));
const localeItems = computed(() => locales.value.map((value) => ({
  label: formatFormLocale(value),
  value,
})));
const title = computed(() => resolveLocalizedText(
  props.form.nameI18n,
  locale.value,
  props.form.defaultLocale,
) ?? '表单');
const description = computed(() => resolveLocalizedText(
  props.form.descriptionI18n ?? undefined,
  locale.value,
  props.form.defaultLocale,
));
const closingMessage = computed(() => resolveLocalizedText(
  props.form.closingMessageI18n ?? undefined,
  locale.value,
  props.form.defaultLocale,
) ?? '提交成功，感谢你的填写。');
const requiresLogin = computed(() => (
  props.form.submissionAccess === 'authentication_required' && !props.authenticated
));
const unavailableCopy = computed<[string, string]>(() => {
  const copies = {
    not_started: ['尚未开放', '这个表单还没有开始收集回答，请稍后再来。'],
    closed: ['填写已结束', '这个表单目前不再接收新的回答。'],
    inactive: ['暂不可用', '表单所使用的数据集当前不可用。'],
    subject_row_missing: ['没有可更新的资料', '你的账号尚未关联到这个表单所需的资料行。'],
    configuration_invalid: ['配置暂不可用', '表单当前的字段或选项配置无效，请联系管理员。'],
  } satisfies Record<NonNullable<PublishedFormDefinition['unavailableReason']>, [string, string]>;
  return copies[props.form.unavailableReason ?? 'closed'];
});

function submit(): void {
  if (props.pending || props.submitted || !props.form.acceptingSubmissions || requiresLogin.value) {
    return;
  }
  const validation = validateFormFilling(
    props.form.schema,
    answers.value,
    locale.value,
    props.form.defaultLocale,
  );
  fieldErrors.value = validation.fieldErrors;
  formErrors.value = validation.formErrors;
  if (!validation.valid) return;
  answers.value = validation.answers;
  emit('submit', {
    answers: validation.answers,
    ...(props.form.submissionContext && {
      expectedRevision: props.form.submissionContext.expectedRevision,
    }),
  });
}
</script>

<template>
  <article
    :lang="locale"
    class="overflow-hidden rounded-[1.75rem] border border-default bg-default shadow-xl
      shadow-neutral-950/5"
  >
    <header
      class="grid gap-8 border-b border-default px-5 py-7 sm:px-8 sm:py-9
        md:grid-cols-[1fr_auto]"
    >
      <div class="min-w-0 border-l-4 border-primary pl-5 sm:pl-6">
        <p class="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-primary">
          ORZ People Platform
        </p>
        <h1 class="text-3xl font-bold tracking-tight text-highlighted sm:text-4xl">
          {{ title }}
        </h1>
        <p
          v-if="description"
          class="mt-4 max-w-[62ch] whitespace-pre-line text-base leading-7 text-muted"
        >
          {{ description }}
        </p>
      </div>

      <div
        v-if="localeItems.length > 1"
        class="w-full self-start md:w-48"
      >
        <label
          for="form-language"
          class="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted"
        >
          填写语言
        </label>
        <USelect
          id="form-language"
          v-model="locale"
          :items="localeItems"
          class="min-h-11 w-full"
          aria-label="选择填写语言"
        />
      </div>
    </header>

    <div class="px-5 py-7 sm:px-8 sm:py-9">
      <section
        v-if="submitted"
        class="py-10 text-center sm:py-14"
        role="status"
        aria-live="polite"
      >
        <div
          class="mx-auto grid size-14 place-items-center rounded-full bg-success/10 text-success"
        >
          <UIcon
            name="i-solar-check-circle-bold-duotone"
            class="size-8"
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
        v-else-if="requiresLogin"
        class="space-y-5"
        role="status"
      >
        <UAlert
          icon="i-solar-lock-keyhole-bold-duotone"
          color="info"
          variant="subtle"
          title="登录后继续填写"
          description="这个表单需要确认你的账号，登录完成后会返回当前页面。"
        />
        <UButton
          class="min-h-11 active:translate-y-px"
          icon="i-solar-login-3-bold-duotone"
          size="lg"
          @click="emit('login')"
        >
          登录并继续
        </UButton>
      </section>

      <section v-else>
        <div
          v-if="formErrors.length > 0 || submitError"
          class="mb-6 rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
          role="alert"
          aria-live="assertive"
        >
          <p
            v-for="message in formErrors"
            :key="message"
          >
            {{ message }}
          </p>
          <p v-if="submitError">
            {{ submitError }}
          </p>
        </div>

        <FormRenderer
          v-model="answers"
          :schema="form.schema"
          mode="fill"
          :locale="locale"
          :default-locale="form.defaultLocale"
          :errors="fieldErrors"
          :choice-options="form.choiceOptions"
          :load-relation-options="loadRelationOptions"
          @submit="submit"
        >
          <template #actions>
            <div class="mt-8 border-t border-default pt-6">
              <UButton
                type="submit"
                size="lg"
                class="min-h-11 w-full justify-center active:translate-y-px sm:w-auto sm:min-w-40"
                icon="i-solar-plain-2-bold-duotone"
                :loading="pending"
                :disabled="pending"
              >
                {{ pending ? '正在提交…' : '提交回答' }}
              </UButton>
              <p
                v-if="pending"
                class="mt-3 text-sm text-muted"
                role="status"
                aria-live="polite"
              >
                正在安全保存，请不要重复提交。
              </p>
            </div>
          </template>
        </FormRenderer>
      </section>
    </div>
  </article>
</template>
