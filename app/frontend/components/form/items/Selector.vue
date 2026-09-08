<script setup lang="ts">
import { computed } from '#imports';
import {
  normalizeFormItemOptions,
  toFormItemOptions,
  type FormItemOptionInput,
  type FormItemValue,
} from './types';
import {
  useFormItemBinding,
  type FormItemProps,
} from './useFormItemBinding';
import { useFormItemOptions } from './useFormItemOptions';

defineOptions({ inheritAttrs: false });

type SelectorModel = FormItemValue | FormItemValue[] | null | undefined;
type SelectorSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type SelectorColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

interface SelectorProps extends FormItemProps {
  items?: FormItemOptionInput[];
  options?: FormItemOptionInput[];
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
  searchable: false,
  size: 'md',
  color: 'primary',
  valueKey: 'value',
  labelKey: 'label',
});
const model = defineModel<SelectorModel>({ default: undefined });
const {
  baseProps,
  disabled,
  modelValue,
  placeholder,
} = useFormItemBinding(props, model);
const relationOptions = useFormItemOptions(() => props.item);
const rawItems = computed<FormItemOptionInput[]>(() => (
  props.items
  ?? props.options
  ?? (relationOptions.hasRelationOptions.value
    ? relationOptions.options.value as FormItemOptionInput[]
    : toFormItemOptions(props.item?.choiceOptions ?? []))
));
const multiple = computed(() => {
  if (props.multiple !== undefined) return props.multiple;
  if (!props.item) return false;
  const property = props.item?.property as Record<string, unknown> | undefined;
  return property?.type === 'array' && property.maxItems !== 1;
});
const storesSingletonArray = computed(() => {
  const property = props.item?.property as Record<string, unknown> | undefined;
  return property?.type === 'array' && property.maxItems === 1;
});
const controlDisabled = computed(() => disabled.value || relationOptions.loading.value);

const normalizedItems = computed(() => normalizeFormItemOptions(rawItems.value, {
  labelKey: props.labelKey,
  valueKey: props.valueKey,
}));

const selectModel = computed<FormItemValue | FormItemValue[] | undefined>({
  get: () => {
    if (multiple.value) {
      if (Array.isArray(modelValue.value)) return modelValue.value;
      return modelValue.value == null ? [] : [modelValue.value];
    }
    return Array.isArray(modelValue.value) ? modelValue.value[0] : modelValue.value ?? undefined;
  },
  set: (value) => {
    if (storesSingletonArray.value) {
      if (value == null || value === '') {
        modelValue.value = [];
      } else {
        modelValue.value = Array.isArray(value) ? value.slice(0, 1) : [value];
      }
      return;
    }
    if (multiple.value) {
      modelValue.value = Array.isArray(value) ? value : [];
      return;
    }
    if (Array.isArray(modelValue.value)) {
      if (value == null || value === '') {
        modelValue.value = [];
        return;
      }
      modelValue.value = Array.isArray(value) ? value : [value];
      return;
    }
    modelValue.value = Array.isArray(value) ? value[0] : value;
  },
});
</script>

<template>
  <FormItemsBase v-bind="baseProps">
    <USelectMenu
      v-if="searchable"
      v-model="selectModel"
      v-bind="$attrs"
      class="w-full"
      :items="normalizedItems"
      :placeholder="placeholder"
      :disabled="controlDisabled"
      :required="baseProps.required"
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
      :disabled="controlDisabled"
      :required="baseProps.required"
      :multiple="multiple"
      :size="size"
      :color="color"
    />

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
