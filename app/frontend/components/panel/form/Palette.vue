<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- Palette keys use widget registry names */
import { formItemTemplates } from '~/utils/form-templates/registry';

withDefaults(defineProps<{
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  add: [widget: string];
}>();
</script>

<template>
  <div class="h-full space-y-4 p-4">
    <div>
      <h2 class="text-sm font-semibold text-highlighted">
        表单项
      </h2>
      <p class="mt-1 text-xs leading-5 text-muted">
        点击控件，将其插入当前选中项之后。
      </p>
    </div>
    <div class="flex flex-col gap-2">
      <UButton
        v-for="widget in formItemTemplates"
        :key="widget.widget"
        :label="widget.label"
        :icon="widget.icon"
        color="neutral"
        variant="soft"
        size="lg"
        block
        :disabled="disabled"
        class="min-h-11 justify-start rounded-xl text-left"
        @click="emit('add', widget.widget)"
      />
    </div>
  </div>
</template>
