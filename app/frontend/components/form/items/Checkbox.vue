<script setup lang="ts">
import { computed } from '#imports';
import type {
  FormItemOption,
  FormItemOptionInput,
} from './types';
import { toFormItemOptions } from './types';
import {
  useFormItemBinding,
  type FormItemProps,
} from './useFormItemBinding';
import { useFormItemOptions } from './useFormItemOptions';

type CheckboxSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type CheckboxColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
type CheckboxOrientation = 'horizontal' | 'vertical';
type CheckboxVariant = 'list' | 'card' | 'table';

interface CheckboxProps extends FormItemProps {
  items?: FormItemOptionInput[];
  boolean?: boolean;
  legend?: string;
  orientation?: CheckboxOrientation;
  variant?: CheckboxVariant;
  size?: CheckboxSize;
  color?: CheckboxColor;
}

const props = withDefaults(defineProps<CheckboxProps>(), {
  items: undefined,
  legend: '',
  orientation: 'vertical',
  variant: 'list',
  size: 'md',
  color: 'primary',
});
const model = defineModel<boolean | string[] | undefined>({ default: undefined });
const {
  baseProps,
  disabled,
  modelValue,
} = useFormItemBinding(props, model);
const relationOptions = useFormItemOptions(() => props.item);

const booleanModel = computed<boolean>({
  get: () => modelValue.value === true,
  set: (value) => { modelValue.value = value; },
});

const groupModel = computed<string[]>({
  get: () => (Array.isArray(modelValue.value) ? modelValue.value : []),
  set: (value) => { modelValue.value = value; },
});

const rawItems = computed(() => (
  props.items
  ?? (relationOptions.hasRelationOptions.value
    ? relationOptions.options.value
    : toFormItemOptions(props.item?.choiceOptions ?? []))
));
const normalizedItems = computed(() => rawItems.value.map((item) => {
  if (typeof item !== 'object') return String(item);
  const option: FormItemOption = { ...item };
  return { ...option, value: String(option.value ?? '') };
}));
const boolean = computed(() => {
  if (props.boolean !== undefined) return props.boolean;
  const property = props.item?.property as Record<string, unknown> | undefined;
  return property?.type === 'boolean' && rawItems.value.length === 0;
});
const controlDisabled = computed(() => disabled.value || relationOptions.loading.value);
</script>

<template>
  <FormItemsBase v-bind="baseProps">
    <UCheckbox
      v-if="boolean"
      v-model="booleanModel"
      v-bind="$attrs"
      :disabled="controlDisabled"
      :required="baseProps.required"
      :size="size"
      :color="color"
    />

    <UCheckboxGroup
      v-else
      v-model="groupModel"
      v-bind="$attrs"
      class="w-full"
      :items="normalizedItems"
      :legend="legend"
      :disabled="controlDisabled"
      :required="baseProps.required"
      :orientation="orientation"
      :variant="variant"
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
