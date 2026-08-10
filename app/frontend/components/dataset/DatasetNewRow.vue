<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- vue-eslint-parser misses this template-scoped alias. */
import type {
  CreateDatasetRowRequest,
  DatasetFieldDefinition,
  JsonValue,
} from '@weave/types';
import {
  getDatasetFieldOptions,
  normalizeDatasetChoiceConfig,
  parseDatasetFieldInputValue,
} from '@weave/utils';
import { reactive, watch } from '#imports';
import FormItemsCascader from '../form/items/Cascader.vue';
import { toFormItemOptions } from '../form/items/types';
import type {
  DatasetOption,
  DatasetRelationOptionState,
} from './types';

const props = withDefaults(defineProps<{
  fields: DatasetFieldDefinition[];
  gridTemplateColumns: string;
  gridMinWidth: number;
  relationOptions?: Record<string, DatasetOption[]>;
  relationOptionStates?: Record<string, DatasetRelationOptionState>;
  pending?: boolean;
  error?: string | null;
}>(), {
  relationOptions: () => ({}),
  relationOptionStates: () => ({}),
  pending: false,
  error: null,
});

const emit = defineEmits<{
  cancel: [];
  relationOptionsRequest: [fieldId: string];
  submit: [input: CreateDatasetRowRequest];
}>();

const drafts = reactive<Record<string, unknown>>({});
const errors = reactive<Record<string, string>>({});

watch(() => props.fields, (fields) => {
  fields.forEach((field) => {
    if (field.isSystemManaged || drafts[field.id] !== undefined) return;
    if (field.kind === 'boolean') drafts[field.id] = false;
    else if (field.kind === 'multi_select'
      || (field.kind === 'relation' && field.relationCardinality === 'many')) {
      drafts[field.id] = [];
    } else drafts[field.id] = '';
  });
}, { immediate: true });

function inputType(field: DatasetFieldDefinition): string {
  if (field.kind === 'number') return 'number';
  if (field.kind === 'date') return 'date';
  if (field.kind === 'time') return 'time';
  if (field.kind === 'datetime') return 'datetime-local';
  if (field.kind === 'email') return 'email';
  if (field.kind === 'url') return 'url';
  return 'text';
}

function isChoiceField(field: DatasetFieldDefinition): boolean {
  return field.kind === 'single_select'
    || field.kind === 'multi_select'
    || field.kind === 'relation';
}

function isCascader(field: DatasetFieldDefinition): boolean {
  if (field.kind !== 'multi_select') return false;
  try {
    return normalizeDatasetChoiceConfig(field.kind, field.config).optionMode === 'cascader';
  } catch {
    return false;
  }
}

function cascaderOptions(field: DatasetFieldDefinition) {
  if (field.kind !== 'multi_select') return [];
  try {
    return toFormItemOptions(normalizeDatasetChoiceConfig(field.kind, field.config).options);
  } catch {
    return [];
  }
}

function isMultiple(field: DatasetFieldDefinition): boolean {
  return field.kind === 'multi_select'
    || (field.kind === 'relation' && field.relationCardinality === 'many');
}

function isFieldDisabled(field: DatasetFieldDefinition): boolean {
  return props.pending || props.relationOptionStates[field.id]?.forbidden === true;
}

function options(field: DatasetFieldDefinition): DatasetOption[] {
  return getDatasetFieldOptions(field, props.relationOptions);
}

function selectValue(fieldId: string): string | string[] {
  const value = drafts[fieldId];
  return Array.isArray(value) ? value.map(String) : String(value ?? '');
}

function cascaderValue(fieldId: string): string[] {
  const value = drafts[fieldId];
  return Array.isArray(value) ? value.map(String) : [];
}

function updateDraft(fieldId: string, value: unknown): void {
  drafts[fieldId] = value;
  errors[fieldId] = '';
}

function handleSelectOpen(open: boolean, field: DatasetFieldDefinition): void {
  if (open && field.kind === 'relation') emit('relationOptionsRequest', field.id);
}

function fieldError(field: DatasetFieldDefinition): string {
  if (field.kind === 'json') return '请输入有效 JSON';
  return field.required ? '此字段为必填项' : '请输入有效值';
}

function submit(): void {
  const values: Record<string, JsonValue> = {};
  const relations: Record<string, string | string[]> = {};
  let valid = true;

  props.fields.forEach((field) => {
    if (field.isSystemManaged) return;
    const parsed = parseDatasetFieldInputValue(field, drafts[field.id]);
    errors[field.id] = parsed.valid ? '' : fieldError(field);
    if (!parsed.valid) {
      valid = false;
      return;
    }
    if (parsed.value === null || parsed.value === ''
      || (Array.isArray(parsed.value) && parsed.value.length === 0)) return;
    if (field.kind === 'relation') {
      relations[field.id] = parsed.value as string | string[];
    } else {
      values[field.id] = parsed.value;
    }
  });

  if (valid) emit('submit', { values, relations });
}
</script>

<template>
  <form
    role="row"
    aria-label="新增数据行"
    class="grid h-11 min-w-full bg-primary-50/40 text-sm text-slate-700"
    :style="{ gridTemplateColumns, minWidth: `${gridMinWidth}px` }"
    @submit.prevent="submit"
  >
    <div
      role="gridcell"
      :class="[
        'sticky left-0 z-10 flex h-11 items-center justify-center border-b border-r',
        'border-primary-100 bg-primary-50 text-primary-700',
      ]"
      aria-label="新增行"
    >
      <UIcon
        name="i-solar-add-circle-bold-duotone"
        class="size-4"
      />
    </div>

    <div
      v-for="field in fields"
      :key="field.id"
      role="gridcell"
      :class="[
        'relative flex h-11 min-w-0 items-center overflow-hidden border-b border-r',
        'border-primary-100',
        errors[field.id] && 'ring-1 ring-inset ring-error-500',
      ]"
      :title="errors[field.id]"
      :aria-invalid="errors[field.id] ? true : undefined"
    >
      <span
        v-if="field.isSystemManaged"
        class="px-3 text-xs text-slate-400"
      >自动填充</span>

      <UCheckbox
        v-else-if="field.kind === 'boolean'"
        :model-value="drafts[field.id] === true"
        :disabled="isFieldDisabled(field)"
        :aria-label="field.name"
        class="px-3"
        @update:model-value="updateDraft(field.id, $event === true)"
      />

      <UTextarea
        v-else-if="field.kind === 'long_text' || field.kind === 'json'"
        :model-value="String(drafts[field.id] ?? '')"
        :disabled="isFieldDisabled(field)"
        :rows="1"
        variant="none"
        class="h-full w-full"
        :ui="{ base: 'h-10 resize-none overflow-y-auto px-2 py-1.5 text-sm' }"
        :aria-label="field.name"
        @update:model-value="updateDraft(field.id, $event)"
      />

      <FormItemsCascader
        v-else-if="isCascader(field)"
        :model-value="cascaderValue(field.id)"
        :items="cascaderOptions(field)"
        :disabled="isFieldDisabled(field)"
        :required="field.required"
        :aria-label="field.name"
        class="w-full"
        @update:model-value="updateDraft(field.id, $event)"
      />

      <USelect
        v-else-if="isChoiceField(field)"
        :model-value="selectValue(field.id)"
        :items="options(field)"
        value-key="value"
        :multiple="isMultiple(field)"
        :disabled="isFieldDisabled(field)"
        variant="none"
        class="w-full"
        :aria-label="field.name"
        @update:open="handleSelectOpen($event, field)"
        @update:model-value="updateDraft(field.id, $event)"
      />

      <UInput
        v-else
        :model-value="String(drafts[field.id] ?? '')"
        :type="inputType(field)"
        :disabled="isFieldDisabled(field)"
        variant="none"
        class="w-full"
        :aria-label="field.name"
        @update:model-value="updateDraft(field.id, $event)"
      />

      <UIcon
        v-if="errors[field.id]"
        name="i-solar-danger-circle-bold-duotone"
        class="pointer-events-none absolute right-2 size-4 text-error-500"
        :title="errors[field.id]"
      />
    </div>

    <div
      role="gridcell"
      class="flex h-11 items-center gap-1 border-b border-primary-100 px-2"
    >
      <UButton
        type="submit"
        label="保存"
        color="primary"
        variant="soft"
        size="xs"
        :loading="pending"
      />
      <UButton
        type="button"
        label="取消"
        color="neutral"
        variant="ghost"
        size="xs"
        :disabled="pending"
        @click="emit('cancel')"
      />
    </div>
  </form>

  <div
    v-if="error"
    role="row"
    class="grid min-w-full"
    :style="{ gridTemplateColumns, minWidth: `${gridMinWidth}px` }"
  >
    <div
      role="gridcell"
      class="border-b border-error-200 bg-error-50 px-3 py-2 text-sm text-error-700"
      :style="{ gridColumn: '1 / -1' }"
    >
      {{ error }}
    </div>
  </div>
</template>
