<script setup lang="ts">
import { computed } from '#imports';
import { resolveInputType } from '../widget-resolution';
import {
  useFormItemBinding,
  type FormItemProps,
} from './useFormItemBinding';

defineOptions({ inheritAttrs: false });

type InputValue = string | number | null | undefined;
type InputSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface InputProps extends FormItemProps {
  type?: string;
  readonly?: boolean;
  size?: InputSize;
  maxLength?: number;
}

const props = defineProps<InputProps>();
const model = defineModel<InputValue>({ default: '' });
const {
  baseProps,
  disabled,
  modelValue,
  placeholder,
} = useFormItemBinding(props, model);

const inputType = computed(() => props.type ?? (
  props.item ? resolveInputType(props.item.property) : 'text'
));
const readonly = computed(() => props.readonly ?? Boolean(
  props.item?.extension.ui?.options?.fromAuthenticatedEmail,
));

const inputModel = computed<string>({
  get: () => {
    if (typeof modelValue.value === 'string') return modelValue.value;
    if (typeof modelValue.value === 'number') return String(modelValue.value);
    return '';
  },
  set: (value) => {
    if (inputType.value === 'number') {
      const parsed = value === '' ? null : Number(value);
      modelValue.value = parsed !== null && Number.isNaN(parsed) ? value : parsed;
      return;
    }
    modelValue.value = value;
  },
});
</script>

<template>
  <FormItemsBase v-bind="baseProps">
    <UInput
      v-model="inputModel"
      v-bind="$attrs"
      class="w-full"
      :type="inputType"
      :placeholder="placeholder"
      :disabled="disabled || readonly"
      :readonly="readonly"
      :required="baseProps.required"
      :maxlength="maxLength"
      :size="size"
    />
  </FormItemsBase>
</template>
