<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- recursive condition arrays do not have persisted ids */
import type {
  AvailableIfExpression,
  AvailableIfLeafOperator,
  JsonValue,
} from '@weave/types';
import { availableIfLeafOperators } from '@weave/types';
import { computed, shallowRef } from '#imports';

defineOptions({ name: 'PanelFormConditionEditor' });

const props = withDefaults(defineProps<{
  depth?: number;
  disabled?: boolean;
  expression?: AvailableIfExpression;
  fieldItems: Array<{ label: string; value: string }>;
}>(), {
  depth: 0,
  disabled: false,
  expression: undefined,
});

const emit = defineEmits<{
  remove: [];
  update: [expression: AvailableIfExpression];
}>();

const valueError = shallowRef<string | null>(null);
const kind = computed(() => {
  if (!props.expression) return 'none';
  if (props.expression.operator === 'and' || props.expression.operator === 'or') return 'group';
  if (props.expression.operator === 'not') return 'not';
  return 'leaf';
});
const leafOperators = availableIfLeafOperators.map((value) => ({ label: value, value }));
const operatorItems = [
  { label: '全部满足 (and)', value: 'and' },
  { label: '任一满足 (or)', value: 'or' },
  { label: '取反 (not)', value: 'not' },
  ...leafOperators,
];

function emptyLeaf(operator: AvailableIfLeafOperator = 'equals'): AvailableIfExpression {
  const fieldId = props.fieldItems[0]?.value ?? '';
  if (operator === 'is_empty' || operator === 'is_not_empty') return { fieldId, operator };
  if (operator === 'in' || operator === 'not_in') return { fieldId, operator, values: [] };
  return { fieldId, operator, value: '' };
}

function changeOperator(operator: string): void {
  if (operator === 'and' || operator === 'or') {
    emit('update', { operator, conditions: [emptyLeaf()] });
    return;
  }
  if (operator === 'not') {
    emit('update', { operator: 'not', condition: emptyLeaf() });
    return;
  }
  emit('update', emptyLeaf(operator as AvailableIfLeafOperator));
}

function updateLeafField(fieldId: string): void {
  if (!props.expression || kind.value !== 'leaf') return;
  emit('update', { ...props.expression, fieldId } as AvailableIfExpression);
}

function parseJson(value: string): JsonValue | undefined {
  try {
    valueError.value = null;
    return JSON.parse(value) as JsonValue;
  } catch {
    valueError.value = '请输入有效 JSON，例如 "yes"、1 或 ["a"]。';
    return undefined;
  }
}

function updateLeafValue(value: string): void {
  const { expression } = props;
  if (!expression || !('fieldId' in expression)) return;
  const parsed = parseJson(value);
  if (parsed === undefined) return;
  if (expression.operator === 'in' || expression.operator === 'not_in') {
    if (!Array.isArray(parsed)) {
      valueError.value = 'in / not_in 的值必须是 JSON 数组。';
      return;
    }
    emit('update', { fieldId: expression.fieldId, operator: expression.operator, values: parsed });
    return;
  }
  if (expression.operator !== 'is_empty' && expression.operator !== 'is_not_empty') {
    emit('update', { fieldId: expression.fieldId, operator: expression.operator, value: parsed });
  }
}

function valueSource(): string {
  const { expression } = props;
  if (!expression || !('fieldId' in expression)) return '';
  if (expression.operator === 'in' || expression.operator === 'not_in') {
    return JSON.stringify(expression.values);
  }
  if (expression.operator === 'is_empty' || expression.operator === 'is_not_empty') {
    return '';
  }
  return 'value' in expression ? JSON.stringify(expression.value) : '';
}

function updateGroupChild(index: number, expression: AvailableIfExpression): void {
  if (!props.expression || (props.expression.operator !== 'and' && props.expression.operator !== 'or')) return;
  const conditions = [...props.expression.conditions];
  conditions[index] = expression;
  emit('update', { ...props.expression, conditions });
}

function removeGroupChild(index: number): void {
  if (!props.expression || (props.expression.operator !== 'and' && props.expression.operator !== 'or')) return;
  const conditions = props.expression.conditions.filter((_, candidate) => candidate !== index);
  if (conditions.length === 0) emit('remove');
  else emit('update', { ...props.expression, conditions });
}

function addGroupChild(): void {
  const { expression } = props;
  if (!expression || (expression.operator !== 'and' && expression.operator !== 'or')) return;
  emit('update', { ...expression, conditions: [...expression.conditions, emptyLeaf()] });
}
</script>

<template>
  <div class="space-y-2 rounded-lg border border-default p-2">
    <div
      v-if="!expression"
      class="flex items-center justify-between gap-2"
    >
      <span class="text-xs text-muted">未设置条件，字段始终显示</span>
      <UButton
        label="添加条件"
        size="xs"
        color="neutral"
        variant="outline"
        :disabled="disabled || fieldItems.length === 0"
        @click="emit('update', emptyLeaf())"
      />
    </div>

    <template v-else>
      <USelect
        v-if="kind === 'leaf'"
        :model-value="'fieldId' in expression ? expression.fieldId : ''"
        :items="fieldItems"
        value-key="value"
        class="w-full"
        placeholder="选择上游表单项"
        :disabled="disabled"
        @update:model-value="updateLeafField(String($event))"
      />
      <div class="flex items-center gap-2">
        <USelect
          :model-value="expression.operator"
          :items="operatorItems"
          value-key="value"
          class="min-w-0 flex-1"
          :disabled="disabled"
          @update:model-value="changeOperator(String($event))"
        />
        <UButton
          v-if="depth > 0"
          icon="i-solar-trash-bin-trash-linear"
          color="error"
          variant="ghost"
          size="xs"
          square
          aria-label="删除条件"
          :disabled="disabled"
          @click="emit('remove')"
        />
      </div>

      <template v-if="kind === 'leaf'">
        <UInput
          v-if="expression.operator !== 'is_empty' && expression.operator !== 'is_not_empty'"
          :model-value="valueSource()"
          class="w-full font-mono text-xs"
          placeholder="JSON 值"
          :disabled="disabled"
          @change="updateLeafValue(($event.target as HTMLInputElement).value)"
        />
        <p
          v-if="valueError"
          class="text-xs text-error"
        >
          {{ valueError }}
        </p>
      </template>

      <div
        v-else-if="
          kind === 'group'
            && (expression.operator === 'and' || expression.operator === 'or')
        "
        class="space-y-2"
      >
        <PanelFormConditionEditor
          v-for="(condition, index) in expression.conditions"
          :key="index"
          :expression="condition"
          :field-items="fieldItems"
          :depth="depth + 1"
          :disabled="disabled"
          @update="updateGroupChild(index, $event)"
          @remove="removeGroupChild(index)"
        />
        <UButton
          label="添加子条件"
          icon="i-solar-add-circle-linear"
          size="xs"
          color="neutral"
          variant="outline"
          :disabled="disabled"
          @click="addGroupChild"
        />
      </div>

      <PanelFormConditionEditor
        v-else-if="kind === 'not' && expression.operator === 'not'"
        :expression="expression.condition"
        :field-items="fieldItems"
        :depth="depth + 1"
        :disabled="disabled"
        @update="emit('update', { operator: 'not', condition: $event })"
        @remove="emit('remove')"
      />
    </template>
  </div>
</template>
