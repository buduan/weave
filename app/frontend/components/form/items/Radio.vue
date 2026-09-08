<script setup lang="ts">
import { computed } from '#imports';
import {
  toFormItemOptions,
  type FormItemOption,
  type FormItemValue,
} from './types';
import {
  useFormItemBinding,
  type FormItemProps,
} from './useFormItemBinding';
import { useFormItemOptions } from './useFormItemOptions';

type RadioSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type RadioColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
type RadioOrientation = 'horizontal' | 'vertical';
type RadioVariant = 'list' | 'card' | 'table';

interface RadioProps extends FormItemProps {
  items?: FormItemOption[];
  legend?: string;
  orientation?: RadioOrientation;
  variant?: RadioVariant;
  size?: RadioSize;
  color?: RadioColor;
}

const props = withDefaults(defineProps<RadioProps>(), {
  items: undefined,
  legend: '',
  orientation: 'vertical',
  variant: 'list',
  size: 'md',
  color: 'primary',
});
const model = defineModel<FormItemValue | FormItemValue[] | undefined>({ default: undefined });
const {
  baseProps,
  disabled,
  modelValue,
} = useFormItemBinding(props, model);
const relationOptions = useFormItemOptions(() => props.item);
const items = computed<FormItemOption[]>(() => (
  props.items
  ?? (relationOptions.hasRelationOptions.value
    ? relationOptions.options.value as FormItemOption[]
    : toFormItemOptions(props.item?.choiceOptions ?? []))
));
const controlDisabled = computed(() => disabled.value || relationOptions.loading.value);
const radioModel = computed<FormItemValue | undefined>({
  get: () => (Array.isArray(modelValue.value) ? modelValue.value[0] : modelValue.value),
  set: (value) => {
    if (value === undefined || value === '') {
      modelValue.value = [];
      return;
    }
    modelValue.value = [value];
  },
});
</script>

<template>
  <FormItemsBase v-bind="baseProps">
    <URadioGroup
      v-model="radioModel"
      v-bind="$attrs"
      class="w-full"
      :items="items"
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
          && items.length === 0"
      />
    </template>
  </FormItemsBase>
</template>
