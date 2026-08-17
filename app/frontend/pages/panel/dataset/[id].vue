<script setup lang="ts">
import { computed, definePageMeta, useRoute } from '#imports';

definePageMeta({
  layout: 'dashboard',
  title: '数据表编辑',
  requiresAuth: true,
});

const route = useRoute();
const datasetId = computed(() => String(route.params.id));
</script>

<template>
  <div class="h-[calc(100dvh-4rem)] min-h-0 overflow-hidden lg:h-full">
    <PanelDatasetEditor :dataset-id="datasetId" />
  </div>
</template>
