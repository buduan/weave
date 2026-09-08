<script setup lang="ts">
import { computed, useAttrs, watch } from '#imports';
import {
  isFormItemOption,
  normalizeFormItemOptions,
  toFormItemOptions,
  type FormItemOption,
  type FormItemOptionInput,
  type FormItemValue,
} from './types';
import {
  useFormItemBinding,
  type FormItemProps,
} from './useFormItemBinding';
import { useFormItemOptions } from './useFormItemOptions';

/* eslint-disable vue/valid-v-for -- each cascade level uses its option set in the key */

defineOptions({ inheritAttrs: false });

type CascaderSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type CascaderColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

interface CascaderProps extends FormItemProps {
  items?: FormItemOptionInput[];
  options?: FormItemOptionInput[];
  levelPlaceholders?: string[];
  size?: CascaderSize;
  color?: CascaderColor;
  valueKey?: string;
  labelKey?: string;
  maxLevels?: 1 | 2 | 3;
}

const props = withDefaults(defineProps<CascaderProps>(), {
  items: undefined,
  options: undefined,
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
const {
  baseProps,
  disabled,
  modelValue,
  placeholder,
} = useFormItemBinding(props, model);
const relationOptions = useFormItemOptions(() => props.item);
const cascaderModel = computed<FormItemValue[]>({
  get: () => (Array.isArray(modelValue.value) ? modelValue.value : []),
  set: (value) => { modelValue.value = value; },
});
const attrs = useAttrs();
const cascadeAttrs = computed(() => {
  const result = { ...attrs };
  delete result.id;
  return result;
});
const rawItems = computed(() => (
  props.items
  ?? props.options
  ?? (relationOptions.hasRelationOptions.value
    ? relationOptions.options.value as FormItemOptionInput[]
    : toFormItemOptions(props.item?.choiceOptions ?? []))
));
const controlDisabled = computed(() => disabled.value || relationOptions.loading.value);

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
  if (cascaderModel.value.length === 0) return false;
  let currentItems = normalizedItems.value;
  for (let level = 0; level < cascaderModel.value.length; level += 1) {
    const selected = findOption(currentItems, cascaderModel.value[level]!);
    if (!selected) return false;
    const children = optionChildren(selected);
    if (level === cascaderModel.value.length - 1) return children.length === 0;
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
    const selected = cascaderModel.value[level];
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
  const levelPlaceholder = props.levelPlaceholders?.[level];
  if (levelPlaceholder) return levelPlaceholder;
  if (level === 0) return placeholder.value ?? '请选择';
  return '请选择下一级';
}

function updateCascade(level: number, value: FormItemValue | undefined): void {
  const nextPath = cascaderModel.value.slice(0, level);
  if (value !== undefined && value !== '') nextPath.push(value);
  modelValue.value = nextPath;
}
</script>

<template>
  <FormItemsBase v-bind="baseProps">
    <div class="grid w-full gap-3 sm:grid-cols-3">
      <USelect
        v-for="(levelItems, level) in levels"
        :id="cascadeId(level)"
        :key="`${level}-${levelItems.length}`"
        :model-value="cascaderModel[level]"
        v-bind="cascadeAttrs"
        class="min-w-0"
        :items="levelItems"
        :placeholder="placeholderFor(level)"
        :disabled="controlDisabled || (level > 0 && cascaderModel[level - 1] == null)"
        :required="baseProps.required"
        :size="size"
        :color="color"
        @update:model-value="updateCascade(level, $event)"
      />
    </div>

    <template #after>
      <FormItemsChoiceStatus
        :loading="relationOptions.loading.value"
        :error="relationOptions.error.value"
        :empty="relationOptions.hasRelationOptions.value
          && !relationOptions.loading.value
          && !relationOptions.error.value
          && normalizedItems.length === 0"
      />
    </template>
  </FormItemsBase>
</template>
