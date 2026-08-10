<script setup lang="ts">
import { computed } from '#imports';
import { normalizeFormItemOptions, type FormItemOptionInput, type FormItemValue } from './types';

defineOptions({ inheritAttrs: false });

type SelectorModel = FormItemValue | FormItemValue[] | null | undefined;
type SelectorSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type SelectorColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

interface SelectorProps {
  items?: FormItemOptionInput[];
  options?: FormItemOptionInput[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  multiple?: boolean;
  searchable?: boolean;
  size?: SelectorSize;
  color?: SelectorColor;
  valueKey?: string;
  labelKey?: string;
}

const props = withDefaults(defineProps<SelectorProps>(), {
  items: undefined,
  options: undefined,
  placeholder: '',
  multiple: false,
  searchable: false,
  size: 'md',
  color: 'primary',
  valueKey: 'value',
  labelKey: 'label',
});
const model = defineModel<SelectorModel>({ default: undefined });
const rawItems = computed(() => props.items ?? props.options ?? []);

const normalizedItems = computed(() => normalizeFormItemOptions(rawItems.value, {
  labelKey: props.labelKey,
  valueKey: props.valueKey,
}));

const selectModel = computed<FormItemValue | FormItemValue[] | undefined>({
  get: () => {
    if (props.multiple) {
      if (Array.isArray(model.value)) return model.value;
      return model.value == null ? [] : [model.value];
    }
    return Array.isArray(model.value) ? model.value[0] : model.value ?? undefined;
  },
  set: (value) => {
    model.value = value;
  },
});
</script>

<template>
  <USelectMenu
    v-if="searchable"
    v-model="selectModel"
    v-bind="$attrs"
    class="w-full"
    :items="normalizedItems"
    :placeholder="placeholder"
    :disabled="disabled"
    :required="required"
    :multiple="multiple"
    :search-input="searchable"
    :size="size"
    :color="color"
  />

  <USelect
    v-else
    v-model="selectModel"
    v-bind="$attrs"
    class="w-full"
    :items="normalizedItems"
    :placeholder="placeholder"
    :disabled="disabled"
    :required="required"
    :multiple="multiple"
    :size="size"
    :color="color"
  />
</template>
