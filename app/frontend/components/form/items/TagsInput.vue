<script setup lang="ts">
import {
  useFormItemBinding,
  type FormItemProps,
} from './useFormItemBinding';

defineOptions({ inheritAttrs: false });

type TagsInputSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface TagsInputProps extends FormItemProps {
  maxLength?: number;
  size?: TagsInputSize;
  addOnBlur?: boolean;
  addOnPaste?: boolean;
  addOnTab?: boolean;
  duplicate?: boolean;
  max?: number;
}

const props = withDefaults(defineProps<TagsInputProps>(), {
  addOnBlur: true,
  maxLength: undefined,
  size: 'md',
  max: undefined,
});
const model = defineModel<string[]>({ default: () => [] });
const {
  baseProps,
  disabled,
  modelValue,
  placeholder,
} = useFormItemBinding(props, model);
</script>

<template>
  <FormItemsBase v-bind="baseProps">
    <UInputTags
      v-model="modelValue"
      v-bind="$attrs"
      class="w-full"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="baseProps.required"
      :max-length="maxLength"
      :size="size"
      :add-on-blur="addOnBlur"
      :add-on-paste="addOnPaste"
      :add-on-tab="addOnTab"
      :duplicate="duplicate"
      :max="max"
    />
  </FormItemsBase>
</template>
