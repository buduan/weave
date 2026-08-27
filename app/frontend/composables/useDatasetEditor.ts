import type {
  ArchiveDatasetFieldRequest,
  ArchiveDatasetRequest,
  CreateDatasetFieldRequest,
  CreateDatasetRowRequest,
  DatasetCapabilities,
  DatasetDetailResponse,
  DatasetFieldDefinition,
  DatasetFieldMutationResponse,
  DatasetOption,
  DatasetRelationOptionPage,
  DatasetRowData,
  DatasetRowRange,
  DatasetTableQuery,
  DatasetWindowQueryResponse,
  DeleteDatasetRowRequest,
  UpdateDatasetFieldRequest,
  UpdateDatasetRequest,
} from '@weave/types';
import {
  canonicalizeDatasetQuery,
  EMPTY_DATASET_QUERY,
  getDatasetQueryFingerprint,
} from '@weave/utils';
import type {
  DatasetCellCommitPayload,
  DatasetCellCoordinates,
  DatasetCellLockState,
  DatasetMutationState,
  DatasetRelationOptionsRequest,
  DatasetRelationOptionState,
  DatasetSelection,
  DatasetVisibleRange,
} from '~/components/dataset/types';
import { toApiError } from '~/utils/api';
import {
  createDatasetCellUpdateRequest,
  isDatasetQueryFieldAffecting,
} from '~/components/panel/dataset/editor-state';
import {
  computed,
  onMounted,
  shallowReadonly,
  shallowRef,
  useNuxtApp,
  useState,
} from '#imports';

const EMPTY_CAPABILITIES: DatasetCapabilities = {
  canUpdateMetadata: false,
  canArchive: false,
  canManageFields: false,
  canCreateRows: false,
  canUpdateRows: false,
  canDeleteRows: false,
};

export function useDatasetEditor(datasetId: string) {
  const { $api } = useNuxtApp();
  const workspaceId = useState<number>('dashboard-workspace-id', () => 1);
  const detail = shallowRef<DatasetDetailResponse | null>(null);
  const detailState = shallowRef<'error' | 'loading' | 'success'>('loading');
  const detailError = shallowRef('');
  const query = shallowRef<DatasetTableQuery>(structuredClone(EMPTY_DATASET_QUERY));
  const selection = shallowRef<DatasetSelection>({ mode: 'explicit', rowIds: [] });
  const collapsedGroupIds = shallowRef<string[]>([]);
  const visibleRanges = shallowRef<DatasetRowRange[]>([{ startIndex: 0, endIndex: 49 }]);
  const locks = shallowRef<DatasetCellLockState[]>([]);
  const mutationStates = shallowRef<DatasetMutationState[]>([]);
  const relationOptions = shallowRef<Record<string, DatasetOption[]>>({});
  const relationOptionErrors = shallowRef<Record<string, string>>({});
  const relationOptionStates = shallowRef<Record<string, DatasetRelationOptionState>>({});
  const relationRequestIds = new Map<string, number>();

  const detailUrl = computed(() => `/workspaces/${workspaceId.value}/datasets/${datasetId}`);
  const dataset = computed(() => detail.value?.dataset ?? null);
  const fields = computed(() => detail.value?.fields ?? []);
  const capabilities = computed(() => detail.value?.capabilities ?? EMPTY_CAPABILITIES);
  const canonicalQuery = computed(() => canonicalizeDatasetQuery(query.value));
  const queryFingerprint = computed(() => getDatasetQueryFingerprint({
    workspaceId: workspaceId.value,
    datasetId,
    definitionRevision: dataset.value?.revision ?? 0,
  }, query.value));

  const windows = useDatasetWindowQuery({
    scope: computed(() => ({
      workspaceId: workspaceId.value,
      datasetId,
      definitionRevision: dataset.value?.revision ?? 0,
    })),
    query,
    canonicalQuery,
    queryFingerprint,
    fetchWindow: (request, signal) => $api.post<DatasetWindowQueryResponse>(
      `${detailUrl.value}/rows/query`,
      request,
      { signal },
    ),
  });

  function message(cause: unknown): string {
    return toApiError(cause).message;
  }

  async function loadDetail(): Promise<void> {
    detailState.value = 'loading';
    detailError.value = '';
    try {
      detail.value = await $api.get<DatasetDetailResponse>(detailUrl.value);
      detailState.value = 'success';
    } catch (cause) {
      detailError.value = message(cause);
      detailState.value = 'error';
    }
  }

  function setMutation(next: DatasetMutationState): void {
    mutationStates.value = [
      ...mutationStates.value.filter((state) => (
        state.rowId !== next.rowId || state.fieldId !== next.fieldId
      )),
      next,
    ];
  }

  function clearMutation(rowId: string, fieldId: string): void {
    mutationStates.value = mutationStates.value.filter((state) => (
      state.rowId !== rowId || state.fieldId !== fieldId
    ));
  }

  function acquireLock(coordinates: DatasetCellCoordinates): void {
    if (!capabilities.value.canUpdateRows) return;
    const field = fields.value.find((item) => item.id === coordinates.fieldId);
    if (!field || field.isSystemManaged) return;
    locks.value = [
      ...locks.value.filter((lock) => (
        lock.rowId !== coordinates.rowId || lock.fieldId !== coordinates.fieldId
      )),
      { ...coordinates, status: 'owned' },
    ];
    if (field.dataType === 'relation' && !relationOptions.value[field.id]) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      loadRelationOptions(field.id).catch(() => undefined);
    }
  }

  function releaseLock(coordinates: DatasetCellCoordinates): void {
    locks.value = locks.value.filter((lock) => (
      lock.rowId !== coordinates.rowId || lock.fieldId !== coordinates.fieldId
    ));
  }

  async function commitCell(payload: DatasetCellCommitPayload): Promise<void> {
    const field = fields.value.find((item) => item.id === payload.fieldId);
    if (!field || field.isSystemManaged || !capabilities.value.canUpdateRows) return;
    if (field.dataType === 'relation' && relationOptionStates.value[field.id]?.forbidden) return;
    setMutation({ ...payload, status: 'pending' });
    const body = createDatasetCellUpdateRequest(field, payload);
    try {
      const row = await $api.patch<DatasetRowData>(
        `${detailUrl.value}/rows/${payload.rowId}`,
        body,
      );
      clearMutation(payload.rowId, payload.fieldId);
      releaseLock(payload);
      if (isDatasetQueryFieldAffecting(query.value, payload.fieldId)) {
        await windows.refreshRanges(visibleRanges.value);
      } else {
        windows.replaceRow(row);
      }
    } catch (cause) {
      const apiError = toApiError(cause);
      setMutation({
        ...payload,
        status: apiError.httpStatus === 409 ? 'conflict' : 'error',
        message: apiError.httpStatus === 409
          ? '该行已被更新，已重新加载可见数据。'
          : apiError.message,
      });
      releaseLock(payload);
      if (apiError.httpStatus === 409) await windows.refreshRanges(visibleRanges.value);
    }
  }

  async function createRow(input: CreateDatasetRowRequest): Promise<void> {
    if (!capabilities.value.canCreateRows) throw new Error('当前数据表不允许新增行');
    await $api.post<DatasetRowData>(`${detailUrl.value}/rows`, input);
    await windows.refreshRanges(visibleRanges.value);
  }

  async function deleteRow(row: DatasetRowData): Promise<void> {
    if (!capabilities.value.canDeleteRows) return;
    await $api.delete<{ accepted: true }>(`${detailUrl.value}/rows/${row.id}`, {
      body: { expectedRevision: row.revision } satisfies DeleteDatasetRowRequest,
    });
    await windows.refreshRanges(visibleRanges.value);
  }

  async function updateMetadata(input: Omit<UpdateDatasetRequest, 'expectedRevision'>): Promise<void> {
    if (!dataset.value || !capabilities.value.canUpdateMetadata) return;
    await $api.patch(detailUrl.value, {
      ...input,
      expectedRevision: dataset.value.revision,
    } satisfies UpdateDatasetRequest);
    await loadDetail();
  }

  async function archiveDataset(): Promise<void> {
    if (!dataset.value || !capabilities.value.canArchive) return;
    await $api.post(`${detailUrl.value}/archive`, {
      expectedRevision: dataset.value.revision,
    } satisfies ArchiveDatasetRequest);
    await loadDetail();
  }

  async function createField(
    input: Omit<CreateDatasetFieldRequest, 'expectedDatasetRevision'>,
  ): Promise<void> {
    if (!dataset.value || !capabilities.value.canManageFields) return;
    await $api.post<DatasetFieldMutationResponse>(`${detailUrl.value}/fields`, {
      ...input,
      expectedDatasetRevision: dataset.value.revision,
    } satisfies CreateDatasetFieldRequest);
    await loadDetail();
  }

  async function updateField(
    field: DatasetFieldDefinition,
    input: Omit<UpdateDatasetFieldRequest, 'expectedDatasetRevision' | 'expectedFieldRevision'>,
  ): Promise<void> {
    if (!dataset.value || !capabilities.value.canManageFields) return;
    await $api.patch<DatasetFieldMutationResponse>(`${detailUrl.value}/fields/${field.id}`, {
      ...input,
      expectedDatasetRevision: dataset.value.revision,
      expectedFieldRevision: field.revision,
    } satisfies UpdateDatasetFieldRequest);
    await loadDetail();
  }

  async function archiveField(field: DatasetFieldDefinition): Promise<void> {
    if (!dataset.value || !capabilities.value.canManageFields || field.isSystemManaged) return;
    await $api.post<DatasetFieldMutationResponse>(`${detailUrl.value}/fields/${field.id}/archive`, {
      expectedDatasetRevision: dataset.value.revision,
      expectedFieldRevision: field.revision,
    } satisfies ArchiveDatasetFieldRequest);
    await loadDetail();
  }

  async function loadRelationOptions(
    input: string | DatasetRelationOptionsRequest,
  ): Promise<void> {
    const request = typeof input === 'string' ? { fieldId: input } : input;
    const {
      fieldId,
      cursor,
      selectedIds = [],
    } = request;
    const search = request.search?.trim() ?? '';
    const previousState = relationOptionStates.value[fieldId];
    const appending = Boolean(cursor) && previousState?.search === search;
    const requestId = (relationRequestIds.get(fieldId) ?? 0) + 1;
    relationRequestIds.set(fieldId, requestId);
    relationOptionErrors.value = { ...relationOptionErrors.value, [fieldId]: '' };
    relationOptionStates.value = {
      ...relationOptionStates.value,
      [fieldId]: {
        status: 'loading',
        search,
        nextCursor: appending ? previousState?.nextCursor : null,
      },
    };
    try {
      const page = await $api.get<DatasetRelationOptionPage>(
        `${detailUrl.value}/fields/${fieldId}/options`,
        {
          query: {
            search: search || undefined,
            cursor,
            selectedIds: selectedIds.length > 0 ? selectedIds : undefined,
          },
        },
      );
      if (relationRequestIds.get(fieldId) !== requestId) return;
      const existing = appending ? relationOptions.value[fieldId] ?? [] : [];
      relationOptions.value = {
        ...relationOptions.value,
        [fieldId]: [
          ...new Map([
            ...existing,
            ...page.items,
          ].map((item) => [item.value, item])).values(),
        ],
      };
      relationOptionStates.value = {
        ...relationOptionStates.value,
        [fieldId]: { status: 'success', search, nextCursor: page.nextCursor },
      };
    } catch (cause) {
      if (relationRequestIds.get(fieldId) !== requestId) return;
      const apiError = toApiError(cause);
      relationOptionErrors.value = {
        ...relationOptionErrors.value,
        [fieldId]: apiError.message,
      };
      relationOptionStates.value = {
        ...relationOptionStates.value,
        [fieldId]: {
          status: 'error',
          error: apiError.message,
          forbidden: apiError.httpStatus === 403,
          search,
          nextCursor: appending ? previousState?.nextCursor : null,
        },
      };
    }
  }

  function updateQuery(nextQuery: DatasetTableQuery): void {
    query.value = structuredClone(nextQuery);
    selection.value = { mode: 'explicit', rowIds: [] };
    collapsedGroupIds.value = [];
  }

  function updateVisibleRange(range: DatasetVisibleRange): void {
    visibleRanges.value = range.rowRanges.length > 0
      ? range.rowRanges
      : visibleRanges.value;
  }

  onMounted(loadDetail);

  return {
    detail: shallowReadonly(detail),
    detailState: shallowReadonly(detailState),
    detailError: shallowReadonly(detailError),
    dataset,
    fields,
    capabilities,
    query: shallowReadonly(query),
    queryFingerprint,
    selection: shallowReadonly(selection),
    collapsedGroupIds: shallowReadonly(collapsedGroupIds),
    locks: shallowReadonly(locks),
    mutationStates: shallowReadonly(mutationStates),
    relationOptions: shallowReadonly(relationOptions),
    relationOptionErrors: shallowReadonly(relationOptionErrors),
    relationOptionStates: shallowReadonly(relationOptionStates),
    ...windows,
    loadDetail,
    updateQuery,
    updateVisibleRange,
    setSelection: (next: DatasetSelection) => { selection.value = next; },
    setCollapsedGroupIds: (next: string[]) => { collapsedGroupIds.value = next; },
    acquireLock,
    releaseLock,
    commitCell,
    createRow,
    deleteRow,
    updateMetadata,
    archiveDataset,
    createField,
    updateField,
    archiveField,
    loadRelationOptions,
  };
}
