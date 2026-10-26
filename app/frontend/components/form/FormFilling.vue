<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- runtime keys use localized validation messages */
import {
  ref,
  watch,
} from '#imports';
import type {
  FormItemId,
  JsonValue,
  PublishedFormDefinition,
  SubmitFormRequest,
} from '@weave/types';
import {
  cloneJson,
  evaluateFormAnswers,
  parseFormSchema,
} from '@weave/utils';

import { validateFormFilling } from '~/utils/form-filling-validation';
import type { FormRenderContext } from './types';

const props = withDefaults(defineProps<{
  authenticatedEmail?: string | null;
  form: PublishedFormDefinition;
  locale: string;
  loadRelationOptions?: FormRenderContext['loadRelationOptions'];
  pending?: boolean;
  submitError?: string | null;
  submitDisabled?: boolean;
}>(), {
  authenticatedEmail: null,
  loadRelationOptions: undefined,
  pending: false,
  submitError: null,
  submitDisabled: false,
});

const emit = defineEmits<{
  submit: [payload: Omit<SubmitFormRequest, 'formId'>];
}>();

const answers = ref<Record<FormItemId, JsonValue | undefined>>({});
const fieldErrors = ref<Record<FormItemId, string>>({});
const formErrors = ref<string[]>([]);

function withAuthenticatedEmail(
  parsed: ReturnType<typeof parseFormSchema>,
  inputAnswers: Record<FormItemId, JsonValue | undefined>,
): Record<FormItemId, JsonValue | undefined> {
  const evaluated = evaluateFormAnswers({
    parsed,
    runtimeSchema: parsed.schema,
    inputAnswers,
    rejectExplicitHidden: false,
  });
  const email = props.authenticatedEmail;
  if (!email) return evaluated.answers;
  const visible = new Set(evaluated.visibleItemIds);
  const next = { ...evaluated.answers };
  parsed.items.forEach((item) => {
    if (item.extension.ui?.options?.fromAuthenticatedEmail && visible.has(item.id)) {
      next[item.id] = email;
    }
  });
  return next;
}

function resetFillingState(): void {
  const parsed = parseFormSchema(props.form.schema, { mode: 'legacy' });
  answers.value = withAuthenticatedEmail(
    parsed,
    cloneJson(props.form.submissionContext?.answers ?? {}),
  );
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

watch(
  () => props.authenticatedEmail,
  (email) => {
    if (!email) return;
    const parsed = parseFormSchema(props.form.schema, { mode: 'legacy' });
    answers.value = withAuthenticatedEmail(parsed, answers.value);
  },
);

function submit(): void {
  if (props.pending || props.submitDisabled || !props.form.acceptingSubmissions) {
    return;
  }
  const validation = validateFormFilling(
    props.form.schema,
    answers.value,
    props.locale,
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
  <div :lang="locale">
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
      :disabled="submitDisabled || pending"
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
            :disabled="pending || submitDisabled"
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
  </div>
</template>
