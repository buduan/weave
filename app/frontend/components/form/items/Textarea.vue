<script setup lang="ts">
import {
  useFormItemBinding,
  type FormItemProps,
} from './useFormItemBinding';

defineOptions({ inheritAttrs: false });

type TextareaSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface TextareaProps extends FormItemProps {
  size?: TextareaSize;
  rows?: number;
  maxLength?: number;
  autoresize?: boolean;
}

const props = defineProps<TextareaProps>();
const model = defineModel<string>({ default: '' });
const {
  baseProps,
  disabled,
  modelValue,
  placeholder,
} = useFormItemBinding(props, model);
</script>

<template>
  <FormItemsBase v-bind="baseProps">
    <UTextarea
      v-model="modelValue"
      v-bind="$attrs"
      class="w-full"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="baseProps.required"
      :rows="rows"
      :autoresize="autoresize"
      :maxlength="maxLength"
      :size="size"
    />
  </FormItemsBase>
</template>
