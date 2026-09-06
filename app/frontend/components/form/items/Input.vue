<script setup lang="ts">
import { computed } from '#imports';

defineOptions({ inheritAttrs: false });

type InputValue = string | number | null | undefined;
type InputSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface InputProps {
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  size?: InputSize;
  maxLength?: number;
}

const props = defineProps<InputProps>();
const model = defineModel<InputValue>({ default: '' });

const inputModel = computed<string>({
  get: () => {
    if (typeof model.value === 'string') return model.value;
    if (typeof model.value === 'number') return String(model.value);
    return '';
  },
  set: (value) => {
    if (props.type === 'number') {
      const parsed = value === '' ? null : Number(value);
      model.value = parsed !== null && Number.isNaN(parsed) ? value : parsed;
      return;
    }
    model.value = value;
  },
});
</script>

<template>
  <UInput
    v-model="inputModel"
    v-bind="$attrs"
    class="w-full"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :disabled="disabled || readonly"
    :readonly="readonly"
    :required="required"
    :maxlength="maxLength"
    :size="size"
  />
</template>
