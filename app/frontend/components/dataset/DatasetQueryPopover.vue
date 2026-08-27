<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- vue-eslint-parser misses these scoped aliases. */
import type { DatasetFieldDefinition, JsonValue } from '@weave/types';
import { computed, shallowRef, watch } from '#imports';
import {
  cloneDatasetQuery,
  getDatasetAggregateOperations,
  getDatasetFieldOptions,
  getDatasetFilterOperators,
  isDatasetFieldGroupable,
} from './dataset-query';
import type { DatasetFilterOperatorOption } from './dataset-query';
import type {
  DatasetAggregateOperation,
  DatasetAggregateRule,
  DatasetFilterRule,
  DatasetOption,
  DatasetQueryKind,
  DatasetRelationOptionsRequest,
  DatasetRelationOptionState,
  DatasetSortRule,
  DatasetTableQuery,
} from './types';

const props = defineProps<{
  kind: DatasetQueryKind;
  fields: DatasetFieldDefinition[];
  query: DatasetTableQuery;
  relationOptions?: Record<string, DatasetOption[]>;
  relationOptionStates?: Record<string, DatasetRelationOptionState>;
  active?: boolean;
  openRequestId?: number;
  requestedFieldId?: string;
}>();

const emit = defineEmits<{
  apply: [query: DatasetTableQuery];
  relationOptionsRequest: [request: DatasetRelationOptionsRequest];
}>();

const open = shallowRef(false);
const initialFieldId = shallowRef<string | null>(null);
const draft = shallowRef(cloneDatasetQuery(props.query));

const title = computed(() => ({
  filter: '筛选',
  sort: '排序',
  group: '分组',
}[props.kind]));

const icon = computed(() => ({
  filter: 'i-solar-filter-bold-duotone',
  sort: 'i-solar-round-sort-vertical-bold-duotone',
  group: 'i-solar-layers-bold-duotone',
}[props.kind]));

const fieldItems = computed(() => props.fields.map((field) => ({
  label: field.name,
  value: field.id,
})));
const groupFieldItems = computed(() => props.fields
  .filter(isDatasetFieldGroupable)
  .map((field) => ({ label: field.name, value: field.id })));
const aggregateFieldItems = computed(() => props.fields
  .filter((field) => getDatasetAggregateOperations(field).length > 0)
  .map((field) => ({ label: field.name, value: field.id })));

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getField(fieldId: string): DatasetFieldDefinition | undefined {
  return props.fields.find((field) => field.id === fieldId);
}

function selectedRelationIds(fieldId: string): string[] {
  const rule = draft.value.filters.find((item) => item.fieldId === fieldId);
  if (!rule) return [];
  if (Array.isArray(rule.value)) return rule.value.map((item) => String(item));
  if (typeof rule.value === 'string' && rule.value) return [rule.value];
  return [];
}

function requestRelationOptions(fieldId: string, search = '', cursor?: string): void {
  if (getField(fieldId)?.dataType !== 'relation') return;
  emit('relationOptionsRequest', {
    fieldId,
    search,
    cursor,
    selectedIds: selectedRelationIds(fieldId),
  });
}

function relationOptionState(fieldId: string): DatasetRelationOptionState | undefined {
  return props.relationOptionStates?.[fieldId];
}

function initialFilterValue(field: DatasetFieldDefinition | undefined): JsonValue {
  if (field?.dataType === 'boolean') return true;
  if (field && (field.dataType === 'string[]'
    || (field.dataType === 'relation' && field.relationCardinality === 'many'))) {
    return [];
  }
  return null;
}

function createFilter(fieldId = props.fields[0]?.id ?? ''): DatasetFilterRule {
  const field = getField(fieldId);
  const operator = field ? getDatasetFilterOperators(field)[0]?.value : 'contains';
  return {
    id: createId('filter'),
    fieldId,
    operator: operator ?? 'contains',
    value: initialFilterValue(field),
  };
}

function createSort(fieldId = props.fields[0]?.id ?? ''): DatasetSortRule {
  return {
    id: createId('sort'),
    fieldId,
    direction: 'asc',
  };
}

function ensureInitialField(fieldId: string): void {
  const next = cloneDatasetQuery(draft.value);
  const field = getField(fieldId);
  if (props.kind === 'filter' && !next.filters.some((rule) => rule.fieldId === fieldId)) {
    next.filters.push(createFilter(fieldId));
  } else if (props.kind === 'sort' && !next.sorts.some((rule) => rule.fieldId === fieldId)) {
    next.sorts.push(createSort(fieldId));
  } else if (props.kind === 'group' && field && isDatasetFieldGroupable(field)) {
    next.group = { fieldId, aggregates: next.group?.aggregates ?? [] };
  }
  draft.value = next;
  requestRelationOptions(fieldId);
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  draft.value = cloneDatasetQuery(props.query);
  draft.value.filters.forEach((rule) => requestRelationOptions(rule.fieldId));
  if (initialFieldId.value) {
    ensureInitialField(initialFieldId.value);
    initialFieldId.value = null;
  }
});

function openPopover(fieldId?: string): void {
  initialFieldId.value = fieldId ?? null;
  open.value = true;
}

watch(() => props.openRequestId, (requestId) => {
  if (requestId === undefined) return;
  openPopover(props.requestedFieldId);
});

function closePopover(): void {
  open.value = false;
}

function apply(): void {
  emit('apply', cloneDatasetQuery(draft.value));
  closePopover();
}

function addFilter(): void {
  draft.value = {
    ...draft.value,
    filters: [...draft.value.filters, createFilter()],
  };
}

function removeFilter(index: number): void {
  draft.value = {
    ...draft.value,
    filters: draft.value.filters.filter((_, ruleIndex) => ruleIndex !== index),
  };
}

function updateFilterField(index: number, fieldId: string): void {
  const field = getField(fieldId);
  const nextFilters = draft.value.filters.map((rule, ruleIndex) => (ruleIndex === index
    ? {
      ...rule,
      fieldId,
      operator: field ? getDatasetFilterOperators(field)[0]?.value ?? 'contains' : 'contains',
      value: initialFilterValue(field),
    }
    : rule));
  draft.value = { ...draft.value, filters: nextFilters };
  requestRelationOptions(fieldId);
}

function updateFilterOperator(index: number, operator: DatasetFilterRule['operator']): void {
  const nextFilters = draft.value.filters.map((rule, ruleIndex) => (ruleIndex === index
    ? { ...rule, operator }
    : rule));
  draft.value = { ...draft.value, filters: nextFilters };
}

function updateFilterOperatorValue(index: number, value: unknown): void {
  updateFilterOperator(index, String(value) as DatasetFilterRule['operator']);
}

function updateFilterValue(index: number, value: JsonValue): void {
  const nextFilters = draft.value.filters.map((rule, ruleIndex) => (ruleIndex === index
    ? { ...rule, value }
    : rule));
  draft.value = { ...draft.value, filters: nextFilters };
}

function updateFilterValueFromUnknown(index: number, value: unknown): void {
  if (value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || Array.isArray(value)) {
    updateFilterValue(index, value as JsonValue);
  }
}

function addSort(): void {
  draft.value = {
    ...draft.value,
    sorts: [...draft.value.sorts, createSort()],
  };
}

function removeSort(index: number): void {
  draft.value = {
    ...draft.value,
    sorts: draft.value.sorts.filter((_, ruleIndex) => ruleIndex !== index),
  };
}

function updateSort(
  index: number,
  key: 'fieldId' | 'direction',
  value: string,
): void {
  const nextSorts = draft.value.sorts.map((rule, ruleIndex) => (ruleIndex === index
    ? { ...rule, [key]: value }
    : rule)) as DatasetSortRule[];
  draft.value = { ...draft.value, sorts: nextSorts };
}

function moveSort(index: number, offset: -1 | 1): void {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= draft.value.sorts.length) return;
  const nextSorts = [...draft.value.sorts];
  const current = nextSorts[index];
  const target = nextSorts[targetIndex];
  if (!current || !target) return;
  nextSorts[index] = target;
  nextSorts[targetIndex] = current;
  draft.value = { ...draft.value, sorts: nextSorts };
}

function setGroupField(fieldId: string | null): void {
  draft.value = {
    ...draft.value,
    group: fieldId === null
      ? null
      : { fieldId, aggregates: draft.value.group?.aggregates ?? [] },
  };
}

function createAggregate(): DatasetAggregateRule | null {
  const field = props.fields.find((item) => getDatasetAggregateOperations(item).length > 0);
  const operation = field ? getDatasetAggregateOperations(field)[0] : undefined;
  return field && operation
    ? { id: createId('aggregate'), fieldId: field.id, operation }
    : null;
}

function addAggregate(): void {
  if (!draft.value.group || draft.value.group.aggregates.length >= 5) return;
  const aggregate = createAggregate();
  if (!aggregate) return;
  draft.value = {
    ...draft.value,
    group: {
      ...draft.value.group,
      aggregates: [...draft.value.group.aggregates, aggregate],
    },
  };
}

function removeAggregate(index: number): void {
  if (!draft.value.group) return;
  draft.value = {
    ...draft.value,
    group: {
      ...draft.value.group,
      aggregates: draft.value.group.aggregates
        .filter((_, aggregateIndex) => aggregateIndex !== index),
    },
  };
}

function updateAggregateField(index: number, fieldId: string): void {
  if (!draft.value.group) return;
  const field = getField(fieldId);
  const operation = field ? getDatasetAggregateOperations(field)[0] : undefined;
  if (!operation) return;
  draft.value = {
    ...draft.value,
    group: {
      ...draft.value.group,
      aggregates: draft.value.group.aggregates.map((rule, aggregateIndex) => (
        aggregateIndex === index ? { ...rule, fieldId, operation } : rule
      )),
    },
  };
}

function updateAggregateOperation(index: number, operation: DatasetAggregateOperation): void {
  if (!draft.value.group) return;
  draft.value = {
    ...draft.value,
    group: {
      ...draft.value.group,
      aggregates: draft.value.group.aggregates.map((rule, aggregateIndex) => (
        aggregateIndex === index ? { ...rule, operation } : rule
      )),
    },
  };
}

function updateAggregateOperationValue(index: number, value: unknown): void {
  updateAggregateOperation(index, String(value) as DatasetAggregateOperation);
}

function aggregateOperationItems(fieldId: string): Array<{
  label: string;
  value: DatasetAggregateOperation;
}> {
  const field = getField(fieldId);
  if (!field) return [];
  const labels: Record<DatasetAggregateOperation, string> = {
    sum: '合计',
    avg: '平均值',
    min: '最小值',
    max: '最大值',
    count_non_empty: '非空计数',
  };
  return getDatasetAggregateOperations(field)
    .map((operation) => ({ label: labels[operation], value: operation }));
}

function operatorItems(rule: DatasetFilterRule): DatasetFilterOperatorOption[] {
  const field = getField(rule.fieldId);
  return field ? getDatasetFilterOperators(field) : [];
}

function requiresFilterValue(rule: DatasetFilterRule): boolean {
  return operatorItems(rule)
    .find((option) => option.value === rule.operator)?.requiresValue ?? true;
}

function selectFilterValue(rule: DatasetFilterRule): string | string[] | undefined {
  if (typeof rule.value === 'string') return rule.value;
  if (Array.isArray(rule.value)) return rule.value.map((item) => String(item));
  return undefined;
}

function filterInputValue(rule: DatasetFilterRule): string {
  return rule.value === null || rule.value === undefined ? '' : String(rule.value);
}

function selectableItems(rule: DatasetFilterRule): DatasetOption[] {
  const field = getField(rule.fieldId);
  return field ? getDatasetFieldOptions(field, props.relationOptions) : [];
}

function isSelectField(fieldId: string): boolean {
  const field = getField(fieldId);
  return field?.kind === 'single_select'
    || field?.kind === 'multi_select'
    || field?.kind === 'cascader'
    || field?.kind === 'tags'
    || field?.dataType === 'relation';
}

function isMultipleField(fieldId: string): boolean {
  const field = getField(fieldId);
  return field?.dataType === 'string[]'
    || (field?.dataType === 'relation' && field.relationCardinality === 'many');
}

function inputType(fieldId: string): string {
  const field = getField(fieldId);
  if (field?.dataType === 'number') return 'number';
  const kind = field?.kind;
  if (kind === 'date') return 'date';
  if (kind === 'time') return 'time';
  if (kind === 'datetime') return 'datetime-local';
  return 'text';
}

</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
  >
    <UButton
      :icon="icon"
      :label="title"
      color="neutral"
      variant="ghost"
      size="sm"
      :class="[
        'rounded-md text-slate-700 hover:bg-slate-200',
        active && 'bg-primary-200 text-primary-950 hover:bg-primary-200',
      ]"
    />

    <template #content>
      <section
        class="w-[min(36rem,calc(100vw-2rem))] p-4"
        :aria-label="`${title}设置`"
      >
        <header class="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 class="text-base font-semibold text-slate-950">
              {{ title }}
            </h2>
            <p class="mt-0.5 text-xs text-slate-500">
              仅对当前页面生效
            </p>
          </div>
          <UButton
            icon="i-solar-close-circle-bold-duotone"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="关闭"
            @click="closePopover"
          />
        </header>

        <div
          v-if="kind === 'filter'"
          class="space-y-3"
        >
          <p
            v-if="draft.filters.length === 0"
            class="rounded-md bg-slate-50 px-3 py-5 text-center text-sm text-slate-500"
          >
            暂无筛选条件
          </p>
          <div
            v-for="(rule, index) in draft.filters"
            :key="rule.id"
            class="rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
              <USelect
                :model-value="rule.fieldId"
                :items="fieldItems"
                value-key="value"
                aria-label="筛选字段"
                @update:model-value="updateFilterField(index, String($event))"
              />
              <USelect
                :model-value="rule.operator"
                :items="operatorItems(rule)"
                value-key="value"
                aria-label="筛选条件"
                @update:model-value="updateFilterOperatorValue(index, $event)"
              />
              <UButton
                icon="i-solar-trash-bin-minimalistic-2-bold-duotone"
                color="neutral"
                variant="ghost"
                aria-label="删除筛选条件"
                @click="removeFilter(index)"
              />
            </div>

            <div
              v-if="requiresFilterValue(rule)"
              class="mt-2"
            >
              <USelect
                v-if="getField(rule.fieldId)?.kind === 'checkbox'"
                :model-value="String(rule.value ?? true)"
                :items="[{ label: '是', value: 'true' }, { label: '否', value: 'false' }]"
                value-key="value"
                aria-label="筛选值"
                @update:model-value="updateFilterValue(index, $event === 'true')"
              />
              <template v-else-if="isSelectField(rule.fieldId)">
                <USelectMenu
                  v-if="getField(rule.fieldId)?.dataType === 'relation'"
                  :model-value="selectFilterValue(rule)"
                  :items="selectableItems(rule)"
                  value-key="value"
                  :multiple="isMultipleField(rule.fieldId)"
                  :search-input="{ placeholder: '搜索关联数据' }"
                  ignore-filter
                  aria-label="筛选值"
                  :loading="relationOptionState(rule.fieldId)?.status === 'loading'"
                  @update:open="$event ? requestRelationOptions(rule.fieldId) : undefined"
                  @update:search-term="requestRelationOptions(rule.fieldId, String($event))"
                  @update:model-value="updateFilterValueFromUnknown(index, $event)"
                >
                  <template #empty>
                    <span class="px-2 py-1 text-xs text-slate-500">
                      {{ relationOptionState(rule.fieldId)?.status === 'loading'
                        ? '正在加载…'
                        : '没有匹配项' }}
                    </span>
                  </template>
                  <template
                    v-if="relationOptionState(rule.fieldId)?.nextCursor"
                    #content-bottom
                  >
                    <UButton
                      label="加载更多"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      block
                      :loading="relationOptionState(rule.fieldId)?.status === 'loading'"
                      @click.stop="requestRelationOptions(
                        rule.fieldId,
                        relationOptionState(rule.fieldId)?.search,
                        relationOptionState(rule.fieldId)?.nextCursor ?? undefined,
                      )"
                    />
                  </template>
                </USelectMenu>
                <USelect
                  v-else
                  :model-value="selectFilterValue(rule)"
                  :items="selectableItems(rule)"
                  value-key="value"
                  :multiple="isMultipleField(rule.fieldId)"
                  aria-label="筛选值"
                  @update:model-value="updateFilterValueFromUnknown(index, $event)"
                />
                <div
                  v-if="relationOptionState(rule.fieldId)?.status === 'error'"
                  class="mt-2 flex items-center justify-between gap-2 text-xs text-error-600"
                >
                  <span class="truncate">
                    {{ relationOptionState(rule.fieldId)?.error ?? '关联选项加载失败' }}
                  </span>
                  <UButton
                    label="重试"
                    color="error"
                    variant="ghost"
                    size="xs"
                    @click="requestRelationOptions(rule.fieldId)"
                  />
                </div>
              </template>
              <UInput
                v-else
                :model-value="filterInputValue(rule)"
                :type="inputType(rule.fieldId)"
                placeholder="请输入筛选值"
                aria-label="筛选值"
                @update:model-value="updateFilterValue(index, $event)"
              />
            </div>
          </div>
          <UButton
            icon="i-solar-add-circle-bold-duotone"
            label="添加筛选条件"
            color="neutral"
            variant="soft"
            :disabled="fields.length === 0"
            @click="addFilter"
          />
        </div>

        <div
          v-else-if="kind === 'sort'"
          class="space-y-3"
        >
          <p
            v-if="draft.sorts.length === 0"
            class="rounded-md bg-slate-50 px-3 py-5 text-center text-sm text-slate-500"
          >
            暂无排序条件
          </p>
          <div
            v-for="(rule, index) in draft.sorts"
            :key="rule.id"
            :class="[
              'grid grid-cols-[auto_minmax(0,1fr)_8rem_auto] items-center gap-2',
              'rounded-lg border border-slate-200 bg-slate-50 p-3',
            ]"
          >
            <span class="w-5 text-center text-xs font-medium text-slate-500">{{ index + 1 }}</span>
            <USelect
              :model-value="rule.fieldId"
              :items="fieldItems"
              value-key="value"
              aria-label="排序字段"
              @update:model-value="updateSort(index, 'fieldId', String($event))"
            />
            <USelect
              :model-value="rule.direction"
              :items="[{ label: '升序', value: 'asc' }, { label: '降序', value: 'desc' }]"
              value-key="value"
              aria-label="排序方向"
              @update:model-value="updateSort(index, 'direction', String($event))"
            />
            <div class="flex">
              <UButton
                icon="i-solar-alt-arrow-up-bold-duotone"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="提高排序优先级"
                :disabled="index === 0"
                @click="moveSort(index, -1)"
              />
              <UButton
                icon="i-solar-alt-arrow-down-bold-duotone"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="降低排序优先级"
                :disabled="index === draft.sorts.length - 1"
                @click="moveSort(index, 1)"
              />
              <UButton
                icon="i-solar-trash-bin-minimalistic-2-bold-duotone"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="删除排序条件"
                @click="removeSort(index)"
              />
            </div>
          </div>
          <UButton
            icon="i-solar-add-circle-bold-duotone"
            label="添加排序条件"
            color="neutral"
            variant="soft"
            :disabled="fields.length === 0"
            @click="addSort"
          />
        </div>

        <div
          v-else
          class="space-y-3"
        >
          <label
            class="block text-sm font-medium text-slate-700"
            for="dataset-group-field"
          >
            分组字段
          </label>
          <div class="flex gap-2">
            <USelect
              id="dataset-group-field"
              :model-value="draft.group?.fieldId"
              :items="groupFieldItems"
              value-key="value"
              placeholder="选择字段"
              class="flex-1"
              @update:model-value="setGroupField(String($event))"
            />
            <UButton
              label="清除"
              color="neutral"
              variant="soft"
              :disabled="!draft.group"
              @click="setGroupField(null)"
            />
          </div>

          <div v-if="draft.group">
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="text-sm font-medium text-slate-700">聚合</span>
              <span class="text-xs text-slate-500">最多 5 项</span>
            </div>
            <div class="space-y-2">
              <div
                v-for="(rule, index) in draft.group.aggregates"
                :key="rule.id"
                class="grid grid-cols-[minmax(0,1fr)_9rem_auto] gap-2"
              >
                <USelect
                  :model-value="rule.fieldId"
                  :items="aggregateFieldItems"
                  value-key="value"
                  aria-label="聚合字段"
                  @update:model-value="updateAggregateField(index, String($event))"
                />
                <USelect
                  :model-value="rule.operation"
                  :items="aggregateOperationItems(rule.fieldId)"
                  value-key="value"
                  aria-label="聚合方式"
                  @update:model-value="updateAggregateOperationValue(index, $event)"
                />
                <UButton
                  icon="i-solar-trash-bin-minimalistic-2-bold-duotone"
                  color="neutral"
                  variant="ghost"
                  aria-label="删除聚合"
                  @click="removeAggregate(index)"
                />
              </div>
            </div>
            <UButton
              icon="i-solar-add-circle-bold-duotone"
              label="添加聚合"
              color="neutral"
              variant="soft"
              class="mt-2"
              :disabled="draft.group.aggregates.length >= 5 || aggregateFieldItems.length === 0"
              @click="addAggregate"
            />
          </div>
        </div>

        <footer class="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="closePopover"
          />
          <UButton
            label="应用"
            color="primary"
            @click="apply"
          />
        </footer>
      </section>
    </template>
  </UPopover>
</template>
