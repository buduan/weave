<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- FormField keys use schema item ids */
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  useTemplateRef,
  watch,
} from '#imports';
import type {
  DatasetChoiceOption,
  FormItemId,
  JsonSchema,
  JsonValue,
} from '@weave/types';
import {
  canonicalizeJson,
  cloneJson,
  evaluateFormAnswers,
  parseFormSchema,
} from '@weave/utils';
import { useFormFieldEditingState } from '~/composables/useFormFieldEditing';
import { resolveFormRenderItems } from '~/utils/form-render-items';
import { transitionFormSelection } from '~/utils/form-selection';
import {
  formRenderContextKey,
  type FormRenderContext,
  type FormRenderMode,
} from './types';

const props = withDefaults(defineProps<{
  schema: JsonSchema;
  mode?: FormRenderMode;
  locale?: string;
  defaultLocale?: string;
  errors?: Readonly<Record<FormItemId, string>>;
  choiceOptions?: Readonly<Record<FormItemId, readonly DatasetChoiceOption[]>>;
  loadRelationOptions?: FormRenderContext['loadRelationOptions'];
}>(), {
  mode: 'fill',
  locale: 'zh-CN',
  defaultLocale: 'zh-CN',
  errors: () => ({}),
  choiceOptions: () => ({}),
  loadRelationOptions: undefined,
});

const state = defineModel<Record<FormItemId, JsonValue | undefined>>({
  default: () => ({}),
});
const selectedFieldId = defineModel<string | null>('selectedFieldId', {
  default: null,
});
const formRoot = useTemplateRef<{ $el: HTMLElement }>('formRoot');

const emit = defineEmits<{
  up: [fieldId: string];
  down: [fieldId: string];
  duplicate: [fieldId: string];
  settings: [fieldId: string];
  delete: [fieldId: string];
  'update:title': [fieldId: string, value: string];
  'update:description': [fieldId: string, value?: string];
  submit: [state: Record<FormItemId, JsonValue | undefined>];
}>();

const { selectedFieldId: activeEditingId, clearEditing } = useFormFieldEditingState();

const parsed = computed(() => parseFormSchema(props.schema, { mode: 'legacy' }));
const evaluation = computed(() => (props.mode === 'fill'
  ? evaluateFormAnswers({
    parsed: parsed.value,
    runtimeSchema: parsed.value.schema,
    inputAnswers: state.value,
    rejectExplicitHidden: false,
  })
  : null));

const resolvedItems = computed(() => {
  const visibleIds = evaluation.value
    ? new Set(evaluation.value.visibleItemIds)
    : undefined;
  return resolveFormRenderItems(
    parsed.value,
    props.locale,
    props.defaultLocale,
    props.choiceOptions,
    visibleIds,
  );
});

const formContext = computed<FormRenderContext>(() => ({
  defaultLocale: props.defaultLocale,
  errors: props.errors,
  loadRelationOptions: props.loadRelationOptions,
  locale: props.locale,
  mode: props.mode,
  state: state.value,
}));

provide(formRenderContextKey, formContext);

/** Apply topological hidden clearing/defaults only when the semantic output changed. */
watch(
  () => evaluation.value?.answers,
  (answers) => {
    if (!answers) return;
    const current = Object.fromEntries(
      Object.entries(state.value).filter((entry) => entry[1] !== undefined),
    ) as Record<FormItemId, JsonValue>;
    if (canonicalizeJson(current) === canonicalizeJson(answers)) return;
    state.value = cloneJson(answers);
  },
  { deep: true, immediate: true },
);

watch(selectedFieldId, (id) => {
  if (id === null && activeEditingId.value !== null) clearEditing();
});

watch(
  () => props.mode,
  (mode) => {
    if (mode === 'fill') clearEditing();
  },
);

const allowEdit = computed(() => props.mode === 'edit');

function onBlankClick(): void {
  if (props.mode !== 'edit') return;
  clearEditing();
  selectedFieldId.value = transitionFormSelection(selectedFieldId.value, { type: 'canvas_blank' });
}

function selectField(fieldId: string): void {
  if (props.mode === 'edit') {
    selectedFieldId.value = transitionFormSelection(
      selectedFieldId.value,
      { type: 'item_select', fieldId },
    );
  }
}

function onDocumentClick(event: MouseEvent): void {
  const form = formRoot.value?.$el;
  if (
    props.mode !== 'edit'
    || !form
    || !(event.target instanceof Node)
    || form.contains(event.target)
  ) return;
  clearEditing();
}

onMounted(() => document.addEventListener('click', onDocumentClick, true));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick, true));

function onSubmit(): void {
  emit('submit', state.value);
}
</script>

<template>
  <UForm
    ref="formRoot"
    :state="state"
    class="space-y-4"
    @submit="onSubmit"
    @click.self="onBlankClick"
  >
    <FormField
      v-for="item in resolvedItems"
      :key="item.id"
      :item="item"
      :allow-edit="allowEdit"
      @select="selectField"
      @up="emit('up', $event)"
      @down="emit('down', $event)"
      @duplicate="emit('duplicate', $event)"
      @settings="emit('settings', $event)"
      @delete="emit('delete', $event)"
      @update:title="(id, value) => emit('update:title', id, value)"
      @update:description="(id, value) => emit('update:description', id, value)"
    />

    <slot
      name="actions"
      :state="state"
      :selected-field-id="selectedFieldId"
    />
  </UForm>
</template>
