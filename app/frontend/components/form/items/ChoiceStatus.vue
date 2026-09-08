<script setup lang="ts">
defineOptions({ name: 'FormItemsChoiceStatus' });

defineProps<{
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
}>();
</script>

<template>
  <p
    v-if="loading"
    class="mt-2 text-sm text-muted"
    role="status"
  >
    正在加载选项…
  </p>
  <p
    v-else-if="error"
    class="mt-2 text-sm text-error"
    role="alert"
  >
    {{ error }}
  </p>
  <p
    v-else-if="empty"
    class="mt-2 text-sm text-muted"
    role="status"
  >
    暂无可用选项
  </p>
</template>
