<script setup lang="ts">
/* eslint-disable no-alert -- native confirm provides the required destructive-change guard */
/* eslint-disable vue/valid-v-for -- option values and index paths are stable editor keys */
import type { DatasetChoiceOption, JsonSchemaObject } from '@weave/types';
import { computed } from '#imports';
import {
  addChoiceOption,
  choiceValueImpacts,
  flattenChoiceOptions,
  moveChoiceOption,
  removeChoiceOption,
  updateChoiceOption,
} from '~/utils/form-choice-options';

const props = withDefaults(defineProps<{
  cascader?: boolean;
  dirty?: boolean;
  disabled?: boolean;
  locale: string;
  options: readonly DatasetChoiceOption[];
  saving?: boolean;
  schema: JsonSchemaObject;
}>(), {
  cascader: false,
  dirty: false,
  disabled: false,
  saving: false,
});

const emit = defineEmits<{
  save: [];
  update: [options: DatasetChoiceOption[]];
}>();

const rows = computed(() => flattenChoiceOptions(props.options));

function patchOption(
  path: readonly number[],
  key: 'color' | 'label' | 'localizedLabel',
  value: string,
): void {
  const row = rows.value.find((candidate) => candidate.path.join('.') === path.join('.'));
  if (!row) return;
  const localized = { ...(row.option.i18n ?? {}) };
  if (key === 'localizedLabel') {
    if (value) localized[props.locale] = value;
    else delete localized[props.locale];
  }
  emit('update', updateChoiceOption(props.options, path, {
    label: key === 'label' ? value : row.option.label,
    color: key === 'color' ? value : row.option.color,
    i18n: localized,
  }));
}

function add(parentPath: readonly number[] = []): void {
  emit('update', addChoiceOption(props.options, parentPath, props.locale));
}

function remove(path: readonly number[], value: string): void {
  const impacts = choiceValueImpacts(props.schema, value);
  if (impacts.length > 0 && !window.confirm(`${impacts.join('\n')}\n确定删除吗？`)) return;
  emit('update', removeChoiceOption(props.options, path));
}
</script>

<template>
  <div class="space-y-3 rounded-xl border border-default p-3">
    <div class="flex items-center justify-between gap-2">
      <div>
        <h3 class="text-xs font-medium text-highlighted">
          {{ cascader ? '级联选项' : '可选项' }}
        </h3>
        <p class="mt-0.5 text-xs text-muted">
          value 创建后不可修改；文案与色值随 Dataset 同步。
        </p>
      </div>
      <UButton
        label="加项"
        icon="i-solar-add-circle-linear"
        color="neutral"
        variant="outline"
        size="xs"
        :disabled="disabled"
        @click="add()"
      />
    </div>

    <div
      v-if="rows.length === 0"
      class="rounded-lg bg-elevated/60 px-3 py-4 text-center text-xs text-muted"
    >
      暂无选项，提交任何非空值都会被拒绝。
    </div>

    <div
      v-for="row in rows"
      :key="row.option.value"
      class="space-y-2 rounded-lg border border-default bg-default p-2"
      :style="{ marginLeft: `${row.depth * 12}px` }"
    >
      <div class="flex items-center gap-1">
        <code class="min-w-0 flex-1 truncate text-[10px] text-dimmed">
          {{ row.option.value }}
        </code>
        <UButton
          icon="i-solar-arrow-up-linear"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          aria-label="上移选项"
          :disabled="disabled"
          @click="emit('update', moveChoiceOption(options, row.path, -1))"
        />
        <UButton
          icon="i-solar-arrow-down-linear"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          aria-label="下移选项"
          :disabled="disabled"
          @click="emit('update', moveChoiceOption(options, row.path, 1))"
        />
        <UButton
          v-if="cascader && row.depth < 2"
          icon="i-solar-add-circle-linear"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          aria-label="添加子项"
          :disabled="disabled"
          @click="add(row.path)"
        />
        <UButton
          icon="i-solar-trash-bin-trash-linear"
          color="error"
          variant="ghost"
          size="xs"
          square
          aria-label="删除选项"
          :disabled="disabled"
          @click="remove(row.path, row.option.value)"
        />
      </div>
      <div class="grid grid-cols-[2.5rem_1fr] gap-2">
        <UInput
          type="color"
          :model-value="row.option.color ?? '#64748b'"
          aria-label="选项色值"
          :disabled="disabled"
          @update:model-value="patchOption(row.path, 'color', String($event))"
        />
        <UInput
          :model-value="row.option.label"
          aria-label="默认选项文案"
          placeholder="默认文案"
          :disabled="disabled"
          @update:model-value="patchOption(row.path, 'label', String($event))"
        />
      </div>
      <UInput
        :model-value="row.option.i18n?.[locale] ?? ''"
        :aria-label="`选项文案 ${locale}`"
        :placeholder="`文案 · ${locale}`"
        :disabled="disabled"
        @update:model-value="patchOption(row.path, 'localizedLabel', String($event))"
      />
    </div>

    <UButton
      label="保存选项到 Dataset"
      block
      :loading="saving"
      :disabled="disabled || !dirty"
      @click="emit('save')"
    />
  </div>
</template>
