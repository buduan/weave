<script setup lang="ts">
import { computed } from '#imports';

defineOptions({ name: 'FormItemsBase' });

const props = defineProps<{
  name?: string;
  label?: string;
  required?: boolean;
  error?: boolean | string;
  labelHidden?: boolean;
}>();

/** 未提供表单元数据时保持为纯控件，便于各表单项单独复用。 */
const wrapsField = computed(() => (
  props.name !== undefined
  || props.label !== undefined
  || props.error !== undefined
));
const ui = computed(() => (props.labelHidden
  ? { label: 'sr-only', container: 'mt-0' }
  : undefined));
</script>

<template>
  <UFormField
    v-if="wrapsField"
    :name="name"
    :label="label"
    :required="required"
    :error="error"
    :ui="ui"
  >
    <slot />
  </UFormField>
  <slot v-else />

  <slot name="after" />
</template>
