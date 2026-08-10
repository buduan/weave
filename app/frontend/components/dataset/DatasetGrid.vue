<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- vue-eslint-parser misses these scoped aliases. */
import type {
  CreateDatasetRowRequest,
  DatasetFieldDefinition,
  JsonValue,
} from '@weave/types';
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { VirtualItem } from '@tanstack/vue-virtual';
import { useEventListener } from '@vueuse/core';
import {
  computed,
  nextTick,
  shallowRef,
  useTemplateRef,
  watch,
} from '#imports';
import DatasetCellEditor from './DatasetCellEditor.vue';
import DatasetNewRow from './DatasetNewRow.vue';
import { getDatasetCellFinalizeActions } from './dataset-cell';
import {
  buildDatasetDisplayItems,
  DATASET_GROUP_HEADER_HEIGHT,
  DATASET_ROW_HEIGHT,
  getDatasetDisplayItemOffset,
  getDatasetDisplayItemSize,
  getDatasetRowRanges,
  validateDatasetGroupDirectory,
} from './dataset-display';
import type { DatasetDisplayItem } from './dataset-display';
import {
  formatDatasetCellValue,
  formatDatasetFieldValue,
  getDatasetCellValue,
  getDatasetFieldOptions,
} from './dataset-query';
import type {
  DatasetCellCoordinates,
  DatasetCellDraftState,
  DatasetCellLockState,
  DatasetFieldAction,
  DatasetFieldActionPayload,
  DatasetGroupSummary,
  DatasetMetadataState,
  DatasetMutationState,
  DatasetOption,
  DatasetRelationOptionState,
  DatasetRelationOptionsRequest,
  DatasetRowAction,
  DatasetRowActionPayload,
  DatasetRowRange,
  DatasetSelection,
  DatasetTableQuery,
  DatasetTableRow,
  DatasetToggleGroupPayload,
  DatasetVisibleRange,
  DatasetWindowState,
} from './types';
import { getDatasetCellKey } from './types';

const INDEX_COLUMN_WIDTH = 56;
const ACTION_COLUMN_WIDTH = 144;

const props = withDefaults(defineProps<{
  fields: DatasetFieldDefinition[];
  query: DatasetTableQuery;
  queryFingerprint: string;
  totalRowCount: number;
  rowSlots: Readonly<Record<number, DatasetTableRow | undefined>>;
  groupDirectory: DatasetGroupSummary[] | null | undefined;
  collapsedGroupIds?: string[];
  metadataState?: DatasetMetadataState;
  windowStates?: DatasetWindowState[];
  mutationStates?: DatasetMutationState[];
  selection?: DatasetSelection;
  locks?: DatasetCellLockState[];
  relationOptions?: Record<string, DatasetOption[]>;
  relationOptionStates?: Record<string, DatasetRelationOptionState>;
  rowActions?: DatasetRowAction[];
  readonlyCellKeys?: string[];
  readonlyFieldIds?: string[];
  canManageFields?: boolean;
  rowCreateActive?: boolean;
  rowCreatePending?: boolean;
  rowCreateError?: string | null;
  readonly?: boolean;
}>(), {
  collapsedGroupIds: () => [],
  metadataState: () => ({ status: 'success' }),
  windowStates: () => [],
  mutationStates: () => [],
  selection: () => ({ mode: 'explicit', rowIds: [] }),
  locks: () => [],
  relationOptions: () => ({}),
  relationOptionStates: () => ({}),
  rowActions: () => [],
  readonlyCellKeys: () => [],
  readonlyFieldIds: () => [],
  canManageFields: false,
  rowCreateActive: false,
  rowCreatePending: false,
  rowCreateError: null,
  readonly: false,
});

const emit = defineEmits<{
  selectionChange: [selection: DatasetSelection];
  fieldAction: [payload: DatasetFieldActionPayload];
  rowAction: [payload: DatasetRowActionPayload];
  cellLockAcquireRequest: [coordinates: DatasetCellCoordinates];
  cellLockReleaseRequest: [coordinates: DatasetCellCoordinates];
  cellCommitRequest: [payload: DatasetCellCoordinates & {
    value: JsonValue;
    expectedRevision: number;
  }];
  toggleGroup: [payload: DatasetToggleGroupPayload];
  windowRangeRequest: [ranges: DatasetRowRange[]];
  visibleRangeChange: [range: DatasetVisibleRange];
  relationOptionsRequest: [request: DatasetRelationOptionsRequest];
  rowCreateRequest: [input: CreateDatasetRowRequest];
  rowCreateCancelRequest: [];
}>();

const viewport = useTemplateRef<HTMLDivElement>('viewport');
const pendingCell = shallowRef<DatasetCellCoordinates | null>(null);
const activeCell = shallowRef<DatasetCellCoordinates | null>(null);
const activeDraft = shallowRef<DatasetCellDraftState | null>(null);
const pendingGroupAnchor = shallowRef<{
  groupId: string;
  viewportOffset: number;
} | null>(null);

const collapsedSet = computed(() => new Set(props.collapsedGroupIds));
const directoryError = computed(() => (props.groupDirectory === undefined
  || props.groupDirectory === null
  ? null
  : validateDatasetGroupDirectory(props.totalRowCount, props.groupDirectory)));
const metadataPending = computed(() => props.query.group !== null
  && (props.metadataState.status === 'loading' || props.groupDirectory === undefined));
const displayItems = computed(() => {
  if (metadataPending.value || props.metadataState.status === 'error' || directoryError.value) {
    return [];
  }
  return buildDatasetDisplayItems(
    props.totalRowCount,
    props.query.group ? props.groupDirectory ?? [] : null,
    collapsedSet.value,
  );
});

const selectedSet = computed(() => new Set(
  props.selection.mode === 'explicit' ? props.selection.rowIds : [],
));
const excludedSet = computed(() => new Set(
  props.selection.mode === 'all_matching'
    && props.selection.queryFingerprint === props.queryFingerprint
    ? props.selection.excludedRowIds
    : [],
));
const isCurrentAllMatching = computed(() => props.selection.mode === 'all_matching'
  && props.selection.queryFingerprint === props.queryFingerprint);
const readonlySet = computed(() => new Set(props.readonlyCellKeys));
const readonlyFieldSet = computed(() => new Set(props.readonlyFieldIds));
const locksByCell = computed(() => new Map(props.locks.map((lock) => [
  getDatasetCellKey(lock.rowId, lock.fieldId),
  lock,
])));
const mutationsByCell = computed(() => new Map(props.mutationStates.map((state) => [
  getDatasetCellKey(state.rowId, state.fieldId),
  state,
])));
const headerSelectionState = computed<boolean | 'indeterminate'>(() => {
  if (isCurrentAllMatching.value) {
    return excludedSet.value.size === 0 ? true : 'indeterminate';
  }
  if (selectedSet.value.size === 0) return false;
  return selectedSet.value.size === props.totalRowCount ? true : 'indeterminate';
});
const hasActionColumn = computed(() => props.rowActions.length > 0 || props.rowCreateActive);

function getFieldWidth(field: DatasetFieldDefinition): number {
  const configuredWidth = field.config.width;
  if (typeof configuredWidth === 'number') {
    return Math.min(Math.max(configuredWidth, 120), 480);
  }
  if (field.kind === 'long_text' || field.kind === 'json') return 260;
  if (field.kind === 'datetime' || field.kind === 'url') return 220;
  return 180;
}

const fieldWidths = computed(() => props.fields.map((field) => getFieldWidth(field)));
const gridTemplateColumns = computed(() => [
  `${INDEX_COLUMN_WIDTH}px`,
  ...fieldWidths.value.map((width) => `${width}px`),
  ...(hasActionColumn.value ? [`${ACTION_COLUMN_WIDTH}px`] : []),
].join(' '));
const gridMinWidth = computed(() => INDEX_COLUMN_WIDTH
  + fieldWidths.value.reduce((total, width) => total + width, 0)
  + (hasActionColumn.value ? ACTION_COLUMN_WIDTH : 0));

const rowVirtualizer = useVirtualizer(computed(() => ({
  count: displayItems.value.length,
  getScrollElement: () => viewport.value,
  estimateSize: (index: number) => {
    const item = displayItems.value[index];
    return item ? getDatasetDisplayItemSize(item) : DATASET_ROW_HEIGHT;
  },
  getItemKey: (index: number) => displayItems.value[index]?.key ?? index,
  overscan: 8,
})));
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());
interface DatasetVirtualEntry {
  item: DatasetDisplayItem;
  virtualRow: VirtualItem;
  group?: DatasetGroupSummary;
  row?: DatasetTableRow;
}

const virtualEntries = computed<DatasetVirtualEntry[]>(() => virtualRows.value.flatMap((
  virtualRow,
): DatasetVirtualEntry[] => {
  const item = displayItems.value[virtualRow.index];
  if (!item) return [];
  if (item.kind === 'group') {
    const group = props.groupDirectory?.[item.groupIndex];
    return group ? [{ item, virtualRow, group }] : [];
  }
  return [{ item, virtualRow, row: props.rowSlots[item.rowIndex] }];
}));
const totalHeight = computed(() => rowVirtualizer.value.getTotalSize());

function getWindowState(rowIndex: number): DatasetWindowState | undefined {
  return props.windowStates.find((state) => rowIndex >= state.offset
    && rowIndex < state.offset + state.limit);
}

function getMutation(rowId: string, fieldId: string): DatasetMutationState | undefined {
  return mutationsByCell.value.get(getDatasetCellKey(rowId, fieldId));
}

function getLock(rowId: string, fieldId: string): DatasetCellLockState | undefined {
  return locksByCell.value.get(getDatasetCellKey(rowId, fieldId));
}

function isActiveCell(rowId: string, fieldId: string): boolean {
  return activeCell.value?.rowId === rowId && activeCell.value?.fieldId === fieldId;
}

function commitCell(
  row: DatasetTableRow,
  fieldId: string,
  value: JsonValue,
): void {
  emit('cellCommitRequest', {
    rowId: row.id,
    fieldId,
    value,
    expectedRevision: row.revision,
  });
}

function releaseCell(coordinates: DatasetCellCoordinates): void {
  emit('cellLockReleaseRequest', coordinates);
  if (isActiveCell(coordinates.rowId, coordinates.fieldId)) {
    activeCell.value = null;
    activeDraft.value = null;
  }
}

function finalizeCellLeavingViewport(coordinates: DatasetCellCoordinates): void {
  const draftState = activeDraft.value;
  const row = Object.values(props.rowSlots)
    .find((item) => item?.id === coordinates.rowId);
  getDatasetCellFinalizeActions(
    draftState?.changed ?? false,
    draftState?.valid ?? true,
  ).forEach((action) => {
    if (action === 'commit' && draftState && row) {
      commitCell(row, coordinates.fieldId, draftState.value);
    }
    if (action === 'release') releaseCell(coordinates);
  });
}

function isRangeCovered(rowIndex: number): boolean {
  return props.rowSlots[rowIndex] !== undefined || getWindowState(rowIndex) !== undefined;
}

watch(virtualEntries, (entries) => {
  if (entries.length === 0) return;
  const first = entries[0];
  const last = entries.at(-1);
  if (!first || !last) return;

  const rowItems = entries.flatMap((entry) => (entry.item.kind === 'row' ? [entry.item] : []));
  const rowRanges = getDatasetRowRanges(rowItems);
  const loadedRows = entries.flatMap((entry) => (entry.row ? [entry.row] : []));
  emit('visibleRangeChange', {
    startDisplayIndex: first.virtualRow.index,
    endDisplayIndex: last.virtualRow.index,
    rowRanges,
    loadedRowIds: loadedRows.map((row) => row.id),
  });

  const missingRanges = getDatasetRowRanges(rowItems.filter((item) => (
    item.kind === 'row' && !isRangeCovered(item.rowIndex)
  )));
  if (missingRanges.length > 0) emit('windowRangeRequest', missingRanges);

  const currentActive = activeCell.value;
  if (currentActive && !loadedRows.some((row) => row.id === currentActive.rowId)) {
    finalizeCellLeavingViewport(currentActive);
  }
}, { flush: 'post' });

watch(() => props.locks, () => {
  const pending = pendingCell.value;
  if (pending) {
    const lock = getLock(pending.rowId, pending.fieldId);
    if (lock?.status === 'owned') {
      activeCell.value = pending;
      activeDraft.value = null;
      pendingCell.value = null;
    } else if (lock?.status === 'remote') {
      pendingCell.value = null;
    }
  }

  const active = activeCell.value;
  if (active && getLock(active.rowId, active.fieldId)?.status !== 'owned') {
    activeCell.value = null;
    activeDraft.value = null;
  }
}, { deep: false });

watch(() => props.queryFingerprint, async (_fingerprint, previousFingerprint) => {
  if (previousFingerprint === undefined) return;
  if (activeCell.value) finalizeCellLeavingViewport(activeCell.value);
  await nextTick();
  if (viewport.value) viewport.value.scrollTop = 0;
});

watch(() => props.rowCreateActive, async (active, previousActive) => {
  if (!active || previousActive) return;
  await nextTick();
  if (viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight;
});

watch(() => props.collapsedGroupIds, async (nextIds, previousIds) => {
  const element = viewport.value;
  if (!element || !props.groupDirectory || !previousIds) return;
  const previousItems = buildDatasetDisplayItems(
    props.totalRowCount,
    props.groupDirectory,
    new Set(previousIds),
  );
  const previousScrollTop = element.scrollTop;
  const anchor = pendingGroupAnchor.value;

  await nextTick();
  rowVirtualizer.value.measure();

  if (anchor) {
    const headerIndex = displayItems.value.findIndex((item) => item.kind === 'group'
      && props.groupDirectory?.[item.groupIndex]?.groupId === anchor.groupId);
    if (headerIndex >= 0) {
      element.scrollTop = Math.max(
        0,
        getDatasetDisplayItemOffset(displayItems.value, headerIndex) - anchor.viewportOffset,
      );
    }
    pendingGroupAnchor.value = null;
    return;
  }

  const previousSet = new Set(previousIds);
  const nextSet = new Set(nextIds);
  let adjustment = 0;
  props.groupDirectory.forEach((group, groupIndex) => {
    if (previousSet.has(group.groupId) === nextSet.has(group.groupId)) return;
    const headerIndex = previousItems.findIndex((item) => item.kind === 'group'
      && item.groupIndex === groupIndex);
    const headerOffset = getDatasetDisplayItemOffset(previousItems, headerIndex);
    if (headerOffset >= previousScrollTop) return;
    adjustment += nextSet.has(group.groupId)
      ? -(group.rowCount * DATASET_ROW_HEIGHT)
      : group.rowCount * DATASET_ROW_HEIGHT;
  });
  element.scrollTop = Math.max(0, previousScrollTop + adjustment);
}, { deep: false, flush: 'post' });

useEventListener(viewport, 'scroll', () => {
  if (pendingCell.value && viewport.value) pendingCell.value = null;
}, { passive: true });

function getFieldIcon(field: DatasetFieldDefinition): string {
  return ({
    text: 'i-solar-text-field-bold-duotone',
    long_text: 'i-solar-document-text-bold-duotone',
    number: 'i-solar-hashtag-bold-duotone',
    boolean: 'i-solar-check-square-bold-duotone',
    date: 'i-solar-calendar-date-bold-duotone',
    time: 'i-solar-clock-circle-bold-duotone',
    datetime: 'i-solar-calendar-bold-duotone',
    email: 'i-solar-letter-bold-duotone',
    url: 'i-solar-link-circle-bold-duotone',
    single_select: 'i-solar-list-arrow-down-minimalistic-bold-duotone',
    multi_select: 'i-solar-list-check-bold-duotone',
    json: 'i-solar-code-2-bold-duotone',
    relation: 'i-solar-branching-paths-down-bold-duotone',
  })[field.kind];
}

function fieldMenuItems(field: DatasetFieldDefinition): Array<Record<string, unknown>> {
  const item = (
    label: string,
    icon: string,
    action: DatasetFieldAction,
    color?: 'error',
  ) => ({
    label,
    icon,
    color,
    onSelect: () => emit('fieldAction', { fieldId: field.id, action }),
  });
  return [
    ...(props.canManageFields ? [
      item('修改字段', 'i-solar-pen-new-square-bold-duotone', 'modify'),
      item('插入字段', 'i-solar-add-square-bold-duotone', 'insert'),
      ...(field.isSystemManaged
        ? []
        : [item('删除字段', 'i-solar-trash-bin-minimalistic-2-bold-duotone', 'delete', 'error')]),
    ] : []),
    item('筛选', 'i-solar-filter-bold-duotone', 'filter'),
    item('分组', 'i-solar-layers-bold-duotone', 'group'),
    item('排序', 'i-solar-round-sort-vertical-bold-duotone', 'sort'),
  ];
}

function isCellReadonly(rowId: string, field: DatasetFieldDefinition): boolean {
  return props.readonly
    || field.isSystemManaged
    || readonlyFieldSet.value.has(field.id)
    || readonlySet.value.has(getDatasetCellKey(rowId, field.id))
    || getMutation(rowId, field.id)?.status === 'pending';
}

function requestCellEdit(rowId: string, field: DatasetFieldDefinition): void {
  if (field.kind === 'relation'
    && props.relationOptionStates[field.id]?.status === 'error') {
    emit('relationOptionsRequest', { fieldId: field.id });
  }
  if (isCellReadonly(rowId, field)) return;
  const lock = getLock(rowId, field.id);
  if (lock?.status === 'remote') return;
  const coordinates = { rowId, fieldId: field.id };
  if (lock?.status === 'owned') {
    activeCell.value = coordinates;
    activeDraft.value = null;
    return;
  }
  pendingCell.value = coordinates;
  emit('cellLockAcquireRequest', coordinates);
}

function updateDraft(state: DatasetCellDraftState): void {
  activeDraft.value = state;
}

function isRowSelected(rowId: string): boolean {
  return isCurrentAllMatching.value
    ? !excludedSet.value.has(rowId)
    : selectedSet.value.has(rowId);
}

function toggleAll(value: boolean | 'indeterminate'): void {
  emit('selectionChange', value === true
    ? {
      mode: 'all_matching',
      queryFingerprint: props.queryFingerprint,
      excludedRowIds: [],
    }
    : { mode: 'explicit', rowIds: [] });
}

function toggleRow(rowId: string, value: boolean | 'indeterminate'): void {
  if (isCurrentAllMatching.value) {
    const excludedRowIds = new Set(excludedSet.value);
    if (value === true) excludedRowIds.delete(rowId);
    else excludedRowIds.add(rowId);
    emit('selectionChange', {
      mode: 'all_matching',
      queryFingerprint: props.queryFingerprint,
      excludedRowIds: [...excludedRowIds],
    });
    return;
  }

  const rowIds = new Set(selectedSet.value);
  if (value === true) rowIds.add(rowId);
  else rowIds.delete(rowId);
  emit('selectionChange', { mode: 'explicit', rowIds: [...rowIds] });
}

function formatGroupKey(group: DatasetGroupSummary): string {
  if (group.groupKey === null || !props.query.group) return '空值';
  const field = props.fields.find((item) => item.id === props.query.group?.fieldId);
  if (field?.kind === 'relation' || field?.kind === 'single_select') {
    const option = getDatasetFieldOptions(field, props.relationOptions)
      .find((item) => item.value === String(group.groupKey));
    if (option) return option.label;
  }
  return formatDatasetCellValue(group.groupKey) || '空值';
}

function aggregateLabels(group: DatasetGroupSummary): string[] {
  return (props.query.group?.aggregates ?? []).map((rule) => {
    const field = props.fields.find((item) => item.id === rule.fieldId);
    const value = group.aggregates[rule.id];
    const operation = ({
      sum: '合计',
      avg: '平均',
      min: '最小',
      max: '最大',
      count_non_empty: '非空',
    })[rule.operation];
    return `${field?.name ?? rule.fieldId} ${operation}：${formatDatasetCellValue(value ?? null) || '—'}`;
  });
}

function toggleGroup(
  group: DatasetGroupSummary,
  displayIndex: number,
): void {
  const collapsing = !collapsedSet.value.has(group.groupId);
  const currentActive = activeCell.value;
  if (collapsing && currentActive) {
    const activeRowIndex = Object.entries(props.rowSlots)
      .find(([, row]) => row?.id === currentActive.rowId)?.[0];
    const rowIndex = activeRowIndex === undefined ? -1 : Number(activeRowIndex);
    if (rowIndex >= group.startRowIndex
      && rowIndex < group.startRowIndex + group.rowCount) {
      finalizeCellLeavingViewport(currentActive);
    }
  }

  const element = viewport.value;
  if (element) {
    pendingGroupAnchor.value = {
      groupId: group.groupId,
      viewportOffset: getDatasetDisplayItemOffset(displayItems.value, displayIndex)
        - element.scrollTop,
    };
  }
  emit('toggleGroup', { groupId: group.groupId, collapsed: collapsing });
}

function retryWindow(rowIndex: number): void {
  emit('windowRangeRequest', [{ startIndex: rowIndex, endIndex: rowIndex }]);
}

function emitRowAction(row: DatasetTableRow, actionId: string): void {
  emit('rowAction', { rowId: row.id, actionId, row });
}

function retryMetadata(): void {
  emit('windowRangeRequest', [{ startIndex: 0, endIndex: 49 }]);
}
</script>

<template>
  <div
    ref="viewport"
    role="grid"
    :aria-rowcount="displayItems.length + 1"
    :aria-colcount="fields.length + 1 + (hasActionColumn ? 1 : 0)"
    class="relative min-h-0 flex-1 overflow-auto bg-white"
  >
    <div
      role="row"
      class="sticky top-0 z-30 grid h-11 bg-white text-sm font-medium text-slate-700"
      :style="{ gridTemplateColumns, minWidth: `${gridMinWidth}px` }"
    >
      <div
        role="columnheader"
        :class="[
          'sticky left-0 z-40 flex items-center justify-center',
          'border-b border-r border-slate-200 bg-white',
        ]"
      >
        <UCheckbox
          :model-value="headerSelectionState"
          :disabled="totalRowCount === 0"
          aria-label="选择当前查询的所有行"
          @update:model-value="toggleAll"
        />
      </div>

      <div
        v-for="field in fields"
        :key="field.id"
        role="columnheader"
        :class="[
          'group/header flex min-w-0 items-center gap-2 px-3',
          'border-b border-r border-slate-200',
        ]"
      >
        <UIcon
          :name="getFieldIcon(field)"
          class="size-4 shrink-0 text-slate-500"
        />
        <span
          class="min-w-0 flex-1 truncate"
          :title="field.name"
        >{{ field.name }}</span>
        <UDropdownMenu :items="fieldMenuItems(field)">
          <UButton
            icon="i-solar-alt-arrow-down-bold-duotone"
            color="neutral"
            variant="ghost"
            size="xs"
            :class="[
              'opacity-0 transition-opacity group-hover/header:opacity-100',
              'group-focus-within/header:opacity-100',
            ]"
            :aria-label="`${field.name}字段设置`"
          />
        </UDropdownMenu>
      </div>

      <div
        v-if="hasActionColumn"
        role="columnheader"
        class="flex items-center border-b border-slate-200 px-3"
      >
        操作
      </div>
    </div>

    <template v-if="displayItems.length > 0">
      <div
        class="relative"
        :style="{ height: `${totalHeight}px`, minWidth: `${gridMinWidth}px` }"
      >
        <div
          v-for="entry in virtualEntries"
          :key="entry.item.key"
          role="row"
          :aria-rowindex="entry.virtualRow.index + 2"
          class="absolute left-0 top-0 grid w-full text-sm text-slate-700"
          :class="entry.item.kind === 'group' ? 'h-14' : 'group/row h-11'"
          :style="{
            height: `${entry.item.kind === 'group'
              ? DATASET_GROUP_HEADER_HEIGHT
              : DATASET_ROW_HEIGHT}px`,
            transform: `translateY(${entry.virtualRow.start}px)`,
            gridTemplateColumns,
          }"
        >
          <div
            v-if="entry.item.kind === 'group' && entry.group"
            role="gridcell"
            :class="[
              'flex h-14 min-w-0 items-center gap-3 overflow-hidden border-b border-primary-100',
              'bg-primary-50 px-3 text-primary-950',
            ]"
            :style="{ gridColumn: '1 / -1' }"
          >
            <button
              type="button"
              :class="[
                'flex size-8 shrink-0 items-center justify-center rounded-md',
                'hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-primary-500',
              ]"
              :aria-expanded="!collapsedSet.has(entry.group.groupId)"
              :aria-label="`${collapsedSet.has(entry.group.groupId)
                ? '展开'
                : '折叠'}分组 ${formatGroupKey(entry.group)}`"
              @click="toggleGroup(entry.group, entry.virtualRow.index)"
            >
              <UIcon
                :name="collapsedSet.has(entry.group.groupId)
                  ? 'i-solar-alt-arrow-right-bold-duotone'
                  : 'i-solar-alt-arrow-down-bold-duotone'"
                class="size-4"
              />
            </button>
            <span
              class="min-w-0 truncate font-medium"
              :title="formatGroupKey(entry.group)"
            >{{ formatGroupKey(entry.group) }}</span>
            <span class="shrink-0 text-xs text-primary-700">
              {{ entry.group.rowCount.toLocaleString('zh-CN') }} 行
            </span>
            <span
              v-for="label in aggregateLabels(entry.group)"
              :key="label"
              class="min-w-0 truncate rounded bg-white/70 px-2 py-1 text-xs text-slate-600"
              :title="label"
            >{{ label }}</span>
          </div>

          <template v-else-if="entry.item.kind === 'row' && entry.row">
            <div
              role="gridcell"
              :class="[
                'sticky left-0 z-10 flex h-11 items-center justify-center bg-white',
                'border-b border-r border-slate-100',
              ]"
            >
              <span
                :class="[
                  'tabular-nums text-xs text-slate-400 group-hover/row:hidden',
                  'group-focus-within/row:hidden',
                  isRowSelected(entry.row.id) && 'hidden',
                ]"
              >
                {{ entry.item.rowIndex + 1 }}
              </span>
              <UCheckbox
                :model-value="isRowSelected(entry.row.id)"
                :aria-label="`选择第 ${entry.item.rowIndex + 1} 行`"
                :class="[
                  'absolute opacity-0 transition-opacity group-hover/row:opacity-100',
                  'focus-within:opacity-100',
                  isRowSelected(entry.row.id) && 'opacity-100',
                ]"
                @update:model-value="toggleRow(entry.row.id, $event)"
              />
            </div>

            <div
              v-for="field in fields"
              :key="field.id"
              role="gridcell"
              class="h-11 min-w-0 overflow-hidden border-b border-r border-slate-100"
            >
              <DatasetCellEditor
                v-if="isActiveCell(entry.row.id, field.id)"
                :key="getDatasetCellKey(entry.row.id, field.id)"
                :row-id="entry.row.id"
                :field="field"
                :value="getDatasetCellValue(entry.row, field)"
                :relation-options="relationOptions"
                :relation-option-state="relationOptionStates[field.id]"
                @draft-change="updateDraft"
                @commit="commitCell(entry.row, field.id, $event)"
                @release="releaseCell({ rowId: entry.row.id, fieldId: field.id })"
                @relation-options-request="emit('relationOptionsRequest', {
                  fieldId: field.id,
                  ...$event,
                })"
              />

              <button
                v-else
                type="button"
                :class="[
                  'flex h-11 w-full min-w-0 items-center gap-2 overflow-hidden',
                  'border border-transparent',
                  'px-3 text-left outline-none transition-colors hover:border-primary-200',
                  'focus-visible:border-primary-500',
                  getLock(entry.row.id, field.id)?.status === 'remote'
                    && 'cursor-not-allowed bg-slate-100/70 text-slate-400',
                  isCellReadonly(entry.row.id, field) && 'cursor-default text-slate-500',
                  getMutation(entry.row.id, field.id)?.status === 'error'
                    && 'border-error-300 bg-error-50',
                  getMutation(entry.row.id, field.id)?.status === 'conflict'
                    && 'border-warning-300 bg-warning-50',
                ]"
                :aria-label="`编辑${field.name}`"
                :aria-disabled="isCellReadonly(entry.row.id, field)
                  || getLock(entry.row.id, field.id)?.status === 'remote'"
                :title="getMutation(entry.row.id, field.id)?.message
                  ?? (getLock(entry.row.id, field.id)?.status === 'remote'
                    ? `${getLock(entry.row.id, field.id)?.ownerName ?? '其他用户'}正在编辑`
                    : formatDatasetFieldValue(field, getDatasetCellValue(entry.row, field)))"
                @click="requestCellEdit(entry.row.id, field)"
              >
                <UIcon
                  v-if="getLock(entry.row.id, field.id)?.status === 'remote'"
                  name="i-solar-lock-keyhole-minimalistic-bold-duotone"
                  class="size-3.5 shrink-0"
                />
                <UIcon
                  v-else-if="getMutation(entry.row.id, field.id)?.status === 'pending'"
                  name="i-solar-refresh-circle-bold-duotone"
                  class="size-3.5 shrink-0 animate-spin"
                />
                <span class="block min-w-0 flex-1 truncate">
                  {{ formatDatasetFieldValue(field, getDatasetCellValue(entry.row, field)) || '—' }}
                </span>
              </button>
            </div>

            <div
              v-if="hasActionColumn"
              role="gridcell"
              :class="[
                'flex h-11 items-center gap-1 overflow-hidden px-2',
                'border-b border-slate-100',
              ]"
            >
              <UButton
                v-for="action in rowActions"
                :key="action.id"
                :icon="action.icon"
                :label="action.label"
                color="secondary"
                variant="soft"
                size="xs"
                :disabled="action.disabled"
                @click="emitRowAction(entry.row, action.id)"
              />
            </div>
          </template>

          <template v-else-if="entry.item.kind === 'row'">
            <div
              role="gridcell"
              :class="[
                'sticky left-0 z-10 flex h-11 items-center justify-center bg-white',
                'border-b border-r border-slate-100 text-xs tabular-nums text-slate-300',
              ]"
            >
              {{ entry.item.rowIndex + 1 }}
            </div>
            <div
              v-if="getWindowState(entry.item.rowIndex)?.status === 'error'"
              role="gridcell"
              :class="[
                'flex h-11 items-center gap-2 overflow-hidden bg-error-50 px-3',
                'border-b border-slate-100 text-xs text-error-700',
              ]"
              :style="{ gridColumn: '2 / -1' }"
            >
              <span class="min-w-0 flex-1 truncate">
                {{ getWindowState(entry.item.rowIndex)?.error ?? '窗口加载失败' }}
              </span>
              <UButton
                label="重试"
                color="error"
                variant="ghost"
                size="xs"
                @click="retryWindow(entry.item.rowIndex)"
              />
            </div>
            <template v-else>
              <div
                v-for="field in fields"
                :key="field.id"
                role="gridcell"
                class="flex h-11 items-center border-b border-r border-slate-100 px-3"
              >
                <div class="h-2 w-full max-w-24 animate-pulse rounded bg-slate-100" />
              </div>
              <div
                v-if="hasActionColumn"
                role="gridcell"
                class="h-11 border-b border-slate-100"
              />
            </template>
          </template>
        </div>
      </div>
    </template>

    <div
      v-else-if="metadataPending"
      class="flex min-h-56 items-center justify-center gap-2 text-sm text-slate-500"
      :style="{ minWidth: `${gridMinWidth}px` }"
      role="status"
    >
      <UIcon
        name="i-solar-refresh-circle-bold-duotone"
        class="size-4 animate-spin"
      />
      正在加载分组目录…
    </div>

    <div
      v-else-if="metadataState.status === 'error' || directoryError"
      class="flex min-h-56 flex-col items-center justify-center gap-2 text-sm text-error-700"
      :style="{ minWidth: `${gridMinWidth}px` }"
      role="alert"
    >
      <span>{{ directoryError ?? metadataState.error ?? '分组元数据加载失败' }}</span>
      <UButton
        label="重试"
        color="error"
        variant="soft"
        size="sm"
        @click="retryMetadata"
      />
    </div>

    <div
      v-else-if="!rowCreateActive"
      class="flex min-h-56 items-center justify-center text-sm text-slate-500"
      :style="{ minWidth: `${gridMinWidth}px` }"
    >
      暂无数据
    </div>

    <DatasetNewRow
      v-if="rowCreateActive"
      :fields="fields"
      :grid-template-columns="gridTemplateColumns"
      :grid-min-width="gridMinWidth"
      :relation-options="relationOptions"
      :relation-option-states="relationOptionStates"
      :pending="rowCreatePending"
      :error="rowCreateError"
      @cancel="emit('rowCreateCancelRequest')"
      @relation-options-request="emit('relationOptionsRequest', { fieldId: $event })"
      @submit="emit('rowCreateRequest', $event)"
    />
  </div>
</template>
