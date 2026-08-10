<script setup lang="ts">
import type { DatasetFieldDefinition, JsonValue } from '@weave/types';
import { useDocumentVisibility, watchDebounced } from '@vueuse/core';
import { computed, shallowRef, watch } from '#imports';
import { normalizeDatasetChoiceConfig, parseDatasetFieldInputValue } from '@weave/utils';
import { getDatasetCellFinalizeActions } from './dataset-cell';
import { getDatasetFieldOptions } from './dataset-query';
import FormItemsCascader from '../form/items/Cascader.vue';
import { toFormItemOptions } from '../form/items/types';
import type {
  DatasetCellDraftState,
  DatasetOption,
  DatasetRelationOptionsRequest,
  DatasetRelationOptionState,
} from './types';

const props = defineProps<{
  rowId: string;
  field: DatasetFieldDefinition;
  value: JsonValue;
  relationOptions?: Record<string, DatasetOption[]>;
  relationOptionState?: DatasetRelationOptionState;
}>();

const emit = defineEmits<{
  draftChange: [state: DatasetCellDraftState];
  commit: [value: JsonValue];
  release: [];
  relationOptionsRequest: [request: Omit<DatasetRelationOptionsRequest, 'fieldId'>];
}>();

type DraftValue = boolean | string | string[];

function toDraftValue(value: JsonValue): DraftValue {
  if (props.field.kind === 'boolean') return value === true;
  if (props.field.kind === 'multi_select'
    || (props.field.kind === 'relation' && props.field.relationCardinality === 'many')) {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }
  if (props.field.kind === 'json') {
    return value === null ? '' : JSON.stringify(value);
  }
  return value === null ? '' : String(value);
}

const documentVisibility = useDocumentVisibility();
const finalized = shallowRef(false);
const selectOpen = shallowRef(false);
const blurredWhileSelectOpen = shallowRef(false);
const relationSearch = shallowRef('');
const draft = shallowRef<DraftValue>(toDraftValue(props.value));

const options = computed(() => getDatasetFieldOptions(
  props.field,
  props.relationOptions,
));
const cascaderConfig = computed(() => {
  if (props.field.kind !== 'multi_select') return null;
  try {
    const config = normalizeDatasetChoiceConfig(props.field.kind, props.field.config);
    return config.optionMode === 'cascader'
      ? { ...config, options: toFormItemOptions(config.options) }
      : null;
  } catch {
    return null;
  }
});
const isMultiple = computed(() => props.field.kind === 'multi_select'
  || (props.field.kind === 'relation' && props.field.relationCardinality === 'many'));
const isSelectEditor = computed(() => props.field.kind === 'single_select'
  || (props.field.kind === 'multi_select' && !cascaderConfig.value)
  || props.field.kind === 'relation');
const selectDraft = computed<string | string[]>(() => (Array.isArray(draft.value)
  ? draft.value
  : String(draft.value)));
const cascaderDraft = computed<string[]>(() => (Array.isArray(draft.value) ? draft.value : []));
const inputType = computed(() => {
  if (props.field.kind === 'number') return 'number';
  if (props.field.kind === 'date') return 'date';
  if (props.field.kind === 'time') return 'time';
  if (props.field.kind === 'datetime') return 'datetime-local';
  if (props.field.kind === 'email') return 'email';
  if (props.field.kind === 'url') return 'url';
  return 'text';
});
const parsedDraft = computed(() => parseDatasetFieldInputValue(props.field, draft.value));
const changed = computed(() => JSON.stringify(parsedDraft.value.value)
  !== JSON.stringify(props.value));

function finalize(): void {
  if (finalized.value) return;
  finalized.value = true;
  getDatasetCellFinalizeActions(changed.value, parsedDraft.value.valid).forEach((action) => {
    if (action === 'commit') emit('commit', parsedDraft.value.value);
    if (action === 'release') emit('release');
  });
}

function selectedRelationIds(): string[] {
  const { value } = selectDraft;
  if (Array.isArray(value)) return value;
  if (value) return [value];
  return [];
}

function requestRelationOptions(search = relationSearch.value, cursor?: string): void {
  emit('relationOptionsRequest', {
    search,
    cursor,
    selectedIds: selectedRelationIds(),
  });
}

watch(draft, () => {
  emit('draftChange', {
    rowId: props.rowId,
    fieldId: props.field.id,
    value: parsedDraft.value.value,
    changed: changed.value,
    valid: parsedDraft.value.valid,
  });
});

watch(documentVisibility, (visibility) => {
  if (visibility === 'hidden') finalize();
});

watch(selectOpen, (isOpen) => {
  if (isOpen && props.field.kind === 'relation') requestRelationOptions();
  if (!isOpen && blurredWhileSelectOpen.value) {
    blurredWhileSelectOpen.value = false;
    finalize();
  }
});

watchDebounced(relationSearch, (search) => {
  if (selectOpen.value && props.field.kind === 'relation') requestRelationOptions(search);
}, { debounce: 250 });

function updateDraft(value: unknown): void {
  if (Array.isArray(value)) {
    draft.value = value.map((item) => String(item));
  } else if (typeof value === 'boolean') {
    draft.value = value;
  } else {
    draft.value = value === null || value === undefined ? '' : String(value);
  }
}

function handleBlur(): void {
  if (selectOpen.value) {
    blurredWhileSelectOpen.value = true;
    return;
  }
  finalize();
}

function cancel(): void {
  if (finalized.value) return;
  finalized.value = true;
  emit('release');
}

watch(() => props.relationOptionState?.forbidden, (forbidden) => {
  if (forbidden) cancel();
});
</script>

<template>
  <div
    :class="[
      'relative flex h-full min-h-0 w-full items-center border bg-white px-1 ring-1 ring-inset',
      parsedDraft.valid
        ? 'border-primary-500 ring-primary-500'
        : 'border-error-500 ring-error-500',
    ]"
    @keydown.esc.stop.prevent="cancel"
  >
    <UTextarea
      v-if="field.kind === 'long_text'"
      :model-value="String(draft)"
      :rows="1"
      autofocus
      variant="none"
      class="h-full max-h-full w-full overflow-hidden"
      :ui="{ base: 'h-9 max-h-9 resize-none overflow-y-auto py-1.5 text-sm' }"
      aria-label="编辑单元格"
      @update:model-value="updateDraft"
      @blur="handleBlur"
      @keydown.meta.enter.stop.prevent="finalize"
      @keydown.ctrl.enter.stop.prevent="finalize"
    />

    <UCheckbox
      v-else-if="field.kind === 'boolean'"
      :model-value="draft === true"
      label="已选择"
      autofocus
      class="px-2"
      @update:model-value="updateDraft"
      @blur="handleBlur"
      @keydown.enter.stop.prevent="finalize"
    />

    <FormItemsCascader
      v-else-if="cascaderConfig"
      :model-value="cascaderDraft"
      :items="cascaderConfig.options"
      :required="field.required"
      autofocus
      class="w-full"
      aria-label="编辑单元格"
      @update:model-value="updateDraft"
      @keydown.enter.stop.prevent="finalize"
    />

    <USelectMenu
      v-else-if="isSelectEditor && field.kind === 'relation'"
      v-model:open="selectOpen"
      :model-value="selectDraft"
      :items="options"
      value-key="value"
      :multiple="isMultiple"
      :search-term="relationSearch"
      :search-input="{ placeholder: '搜索关联数据' }"
      ignore-filter
      autofocus
      variant="none"
      class="w-full"
      aria-label="编辑单元格"
      :loading="relationOptionState?.status === 'loading'"
      @update:model-value="updateDraft"
      @update:search-term="relationSearch = $event"
      @blur="handleBlur"
      @keydown.enter.stop="selectOpen = true"
    >
      <template #empty>
        <span class="px-2 py-1 text-xs text-slate-500">
          {{ relationOptionState?.status === 'loading' ? '正在加载…' : '没有匹配项' }}
        </span>
      </template>
      <template
        v-if="relationOptionState?.nextCursor"
        #content-bottom
      >
        <UButton
          label="加载更多"
          color="neutral"
          variant="ghost"
          size="xs"
          block
          :loading="relationOptionState.status === 'loading'"
          @click.stop="requestRelationOptions(
            relationOptionState.search,
            relationOptionState.nextCursor ?? undefined,
          )"
        />
      </template>
    </USelectMenu>

    <USelect
      v-else-if="isSelectEditor"
      v-model:open="selectOpen"
      :model-value="selectDraft"
      :items="options"
      value-key="value"
      :multiple="isMultiple"
      autofocus
      variant="none"
      class="w-full"
      aria-label="编辑单元格"
      @update:model-value="updateDraft"
      @blur="handleBlur"
      @keydown.enter.stop="selectOpen = true"
    />

    <UInput
      v-else
      :model-value="String(draft)"
      :type="inputType"
      autofocus
      variant="none"
      class="w-full"
      aria-label="编辑单元格"
      @update:model-value="updateDraft"
      @blur="handleBlur"
      @keydown.enter.stop.prevent="finalize"
    />

    <UIcon
      v-if="!parsedDraft.valid"
      name="i-solar-danger-circle-bold-duotone"
      class="mr-1 size-4 shrink-0 text-error-500"
      title="当前值无效，将不会提交"
    />
  </div>
</template>
