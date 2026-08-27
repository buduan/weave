<script setup lang="ts">
import { computed } from '#imports';
import type { FormItemOption, FormItemValue } from './types';

type RadioSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type RadioColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
type RadioOrientation = 'horizontal' | 'vertical';
type RadioVariant = 'list' | 'card' | 'table';

interface RadioProps {
  items?: FormItemOption[];
  legend?: string;
  disabled?: boolean;
  required?: boolean;
  orientation?: RadioOrientation;
  variant?: RadioVariant;
  size?: RadioSize;
  color?: RadioColor;
}

const props = withDefaults(defineProps<RadioProps>(), {
  items: () => [],
  legend: '',
  orientation: 'vertical',
  variant: 'list',
  size: 'md',
  color: 'primary',
});
const model = defineModel<FormItemValue | FormItemValue[] | undefined>({ default: undefined });
const radioModel = computed<FormItemValue | undefined>({
  get: () => (Array.isArray(model.value) ? model.value[0] : model.value),
  set: (value) => {
    if (value === undefined || value === '') {
      model.value = [];
      return;
    }
    model.value = [value];
  },
});
</script>

<template>
  <URadioGroup
    v-model="radioModel"
    v-bind="$attrs"
    class="w-full"
    :items="items"
    :legend="legend"
    :disabled="disabled"
    :required="required"
    :orientation="orientation"
    :variant="variant"
    :size="size"
    :color="color"
  />
</template>
