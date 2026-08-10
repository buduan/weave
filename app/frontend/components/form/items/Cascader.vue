<script setup lang="ts">
import { computed, useAttrs, watch } from '#imports';
import {
  isFormItemOption,
  normalizeFormItemOptions,
  type FormItemOption,
  type FormItemOptionInput,
  type FormItemValue,
} from './types';

/* eslint-disable vue/valid-v-for -- each cascade level uses its option set in the key */

defineOptions({ inheritAttrs: false });

type CascaderSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type CascaderColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

interface CascaderProps {
  items?: FormItemOptionInput[];
  options?: FormItemOptionInput[];
  placeholder?: string;
  levelPlaceholders?: string[];
  disabled?: boolean;
  required?: boolean;
  size?: CascaderSize;
  color?: CascaderColor;
  valueKey?: string;
  labelKey?: string;
  maxLevels?: 1 | 2 | 3;
}

const props = withDefaults(defineProps<CascaderProps>(), {
  items: undefined,
  options: undefined,
  placeholder: '',
  levelPlaceholders: () => [],
  maxLevels: 3,
  size: 'md',
  color: 'primary',
  valueKey: 'value',
  labelKey: 'label',
});
const model = defineModel<FormItemValue[]>({ default: () => [] });
const emit = defineEmits<{
  completionChange: [complete: boolean];
}>();
const attrs = useAttrs();
const cascadeAttrs = computed(() => {
  const result = { ...attrs };
  delete result.id;
  return result;
});
const rawItems = computed(() => props.items ?? props.options ?? []);

const normalizedItems = computed(() => normalizeFormItemOptions(rawItems.value, {
  labelKey: props.labelKey,
  recursive: true,
  valueKey: props.valueKey,
}));

function optionValue(item: FormItemOptionInput): FormItemValue {
  if (!isFormItemOption(item)) return item;
  return item.value ?? '';
}

function optionChildren(item: FormItemOptionInput): FormItemOption[] {
  return isFormItemOption(item) && Array.isArray(item.children) ? item.children : [];
}

function findOption(optionItems: FormItemOptionInput[], value: FormItemValue) {
  return optionItems.find((item) => optionValue(item) === value);
}

const complete = computed(() => {
  if (model.value.length === 0) return false;
  let currentItems = normalizedItems.value;
  for (let level = 0; level < model.value.length; level += 1) {
    const selected = findOption(currentItems, model.value[level]!);
    if (!selected) return false;
    const children = optionChildren(selected);
    if (level === model.value.length - 1) return children.length === 0;
    currentItems = children;
  }
  return false;
});

watch(complete, (value) => emit('completionChange', value), { immediate: true });

const levels = computed(() => {
  const result: FormItemOptionInput[][] = [];
  let currentItems = normalizedItems.value;

  for (let level = 0; level < props.maxLevels; level += 1) {
    result.push(currentItems);
    const selected = model.value[level];
    if (selected === undefined) break;
    currentItems = optionChildren(findOption(currentItems, selected) ?? '');
    if (currentItems.length === 0) break;
  }

  return result;
});

function cascadeId(level: number): string | undefined {
  return typeof attrs.id === 'string' ? `${attrs.id}-${level + 1}` : undefined;
}

function placeholderFor(level: number): string {
  const placeholder = props.levelPlaceholders?.[level];
  if (placeholder) return placeholder;
  if (level === 0) return props.placeholder ?? '请选择';
  return '请选择下一级';
}

function updateCascade(level: number, value: FormItemValue | undefined): void {
  const nextPath = model.value.slice(0, level);
  if (value !== undefined && value !== '') nextPath.push(value);
  model.value = nextPath;
}
</script>

<template>
  <div class="grid w-full gap-3 sm:grid-cols-3">
    <USelect
      v-for="(levelItems, level) in levels"
      :id="cascadeId(level)"
      :key="`${level}-${levelItems.length}`"
      :model-value="model[level]"
      v-bind="cascadeAttrs"
      class="min-w-0"
      :items="levelItems"
      :placeholder="placeholderFor(level)"
      :disabled="disabled || (level > 0 && model[level - 1] == null)"
      :required="required"
      :size="size"
      :color="color"
      @update:model-value="updateCascade(level, $event)"
    />
  </div>
</template>
