import type {
  DatasetCapabilities,
  DatasetFieldDefinition,
  DatasetStatus,
  DatasetTableQuery,
  UpdateDatasetRowRequest,
} from '@weave/types';
import type { DatasetCellCommitPayload } from '~/components/dataset/types';

export function getDatasetEditorPath(datasetId: string): string {
  return `/panel/dataset/${datasetId}`;
}

export function createDatasetCellUpdateRequest(
  field: DatasetFieldDefinition,
  payload: DatasetCellCommitPayload,
): UpdateDatasetRowRequest {
  return {
    expectedRevision: payload.expectedRevision,
    ...(field.dataType === 'relation'
      ? { relations: { [field.id]: payload.value as string | string[] } }
      : { values: { [field.id]: payload.value } }),
  };
}

export function isDatasetQueryFieldAffecting(
  query: DatasetTableQuery,
  fieldId: string,
): boolean {
  return query.filters.some((rule) => rule.fieldId === fieldId)
    || query.sorts.some((rule) => rule.fieldId === fieldId)
    || query.group?.fieldId === fieldId
    || query.group?.aggregates.some((rule) => rule.fieldId === fieldId) === true;
}

export function isDatasetEditorReadonly(
  status: DatasetStatus | undefined,
  capabilities: DatasetCapabilities,
): boolean {
  return status === 'archived' || !capabilities.canUpdateRows;
}

export function toggleDatasetGroupId(
  groupIds: readonly string[],
  groupId: string,
  collapsed: boolean,
): string[] {
  const next = new Set(groupIds);
  if (collapsed) next.add(groupId);
  else next.delete(groupId);
  return [...next];
}
