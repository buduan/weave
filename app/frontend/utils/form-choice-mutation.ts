import type {
  DatasetChoiceOption,
  DatasetFieldDefinition,
  DatasetFieldMutationResponse,
  DatasetPanelDetail,
  JsonObject,
  UpdateDatasetFieldRequest,
} from '@weave/types';
import { cloneJson } from '@weave/utils';

export function buildChoiceUpdateRequest(
  dataset: DatasetPanelDetail,
  field: DatasetFieldDefinition,
  options: readonly DatasetChoiceOption[],
): UpdateDatasetFieldRequest {
  return {
    expectedDatasetRevision: dataset.revision,
    expectedFieldRevision: field.revision,
    config: { ...field.config, options } as unknown as JsonObject,
  };
}

export function applyChoiceMutationResult(
  dataset: DatasetPanelDetail,
  result: DatasetFieldMutationResponse,
): DatasetPanelDetail {
  return {
    ...dataset,
    revision: result.datasetRevision,
    fields: dataset.fields.map((field) => (field.id === result.field.id ? result.field : field)),
  };
}

export function settleChoiceDrafts(
  drafts: Readonly<Record<string, DatasetChoiceOption[]>>,
  fieldId: string,
  outcome: 'conflict' | 'success',
): Record<string, DatasetChoiceOption[]> {
  if (outcome === 'conflict') return cloneJson(drafts);
  const next = cloneJson(drafts) as Record<string, DatasetChoiceOption[]>;
  delete next[fieldId];
  return next;
}
