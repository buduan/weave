import type { ErrorObject } from 'ajv/dist/2020';

import type {
  DatasetChoiceOption,
  DatasetFieldKind,
  FormItemId,
  JsonSchema,
  JsonSchemaObject,
  JsonValue,
  RelationCardinality,
} from '@weave/types';

import {
  enumerateChoiceLeafPaths,
  normalizeDatasetChoiceConfig,
  resolveDatasetChoiceLabels,
  stripChoiceMembershipSchema,
} from './dataset-choices';
import { cloneJson } from './json-clone';
import { createFormAjv } from './form-ajv';
import { isRecord } from './json-guards';
import {
  getChoiceOptions,
  getPropertyDefault,
  isItemVisible,
  type ParsedFormSchema,
} from './form-schema';

export interface CurrentFormDatasetField {
  archivedAt: unknown | null;
  config: unknown;
  datasetId: string;
  id: string;
  isSystemManaged: boolean;
  kind: DatasetFieldKind;
  relationCardinality: RelationCardinality | null;
  valueSchema: JsonSchema;
}

export interface ProjectCurrentFormFieldsOptions {
  locale?: string;
}

export interface ProjectedFormFields {
  choiceOptions: Readonly<Record<FormItemId, readonly DatasetChoiceOption[]>>;
  configurationInvalidItemIds: readonly FormItemId[];
  fieldsByItemId: ReadonlyMap<FormItemId, CurrentFormDatasetField>;
  schema: JsonSchemaObject;
}

export interface FormDefaultDiagnostic {
  errors: readonly ErrorObject[];
  itemId: FormItemId;
}

export interface EvaluateFormAnswersInput {
  inputAnswers: Readonly<Record<FormItemId, JsonValue | undefined>>;
  parsed: ParsedFormSchema;
  rejectExplicitHidden: boolean;
  runtimeSchema: JsonSchemaObject;
}

export interface EvaluatedFormAnswers {
  answers: Record<FormItemId, JsonValue>;
  defaultDiagnostics: readonly FormDefaultDiagnostic[];
  effectiveSchema: JsonSchemaObject;
  hiddenSubmittedItemIds: readonly FormItemId[];
  unknownItemIds: readonly FormItemId[];
  visibleItemIds: readonly FormItemId[];
}

const defaultAjv = createFormAjv();

function appendAllOfConstraint(
  property: JsonSchemaObject,
  constraint: JsonSchema,
): void {
  const existing = Array.isArray(property.allOf) ? property.allOf : [];
  property.allOf = [...existing, cloneJson(constraint)] as JsonValue;
}

function projectFlatChoice(
  property: JsonSchemaObject,
  kind: Extract<DatasetFieldKind, 'multi_select' | 'single_select'>,
  options: readonly DatasetChoiceOption[],
): void {
  const values = options.map((option) => option.value);
  if (values.length === 0) {
    appendAllOfConstraint(property, false);
    return;
  }
  if (kind === 'single_select') {
    property.enum = values;
    return;
  }
  const items = isRecord(property.items)
    ? cloneJson(property.items) as JsonSchemaObject
    : { type: 'string' } as JsonSchemaObject;
  items.enum = values;
  property.items = items;
  property.uniqueItems = true;
}

function projectCascaderChoice(
  property: JsonSchemaObject,
  options: readonly DatasetChoiceOption[],
): void {
  const paths = enumerateChoiceLeafPaths(options);
  property.items = isRecord(property.items)
    ? { ...property.items, type: 'string' }
    : { type: 'string' };
  if (paths.length === 0) appendAllOfConstraint(property, false);
  else property.enum = paths;
}

/**
 * Combine immutable author constraints with one transactionally current Dataset definition.
 * The returned Schema and choice trees are detached; neither input is mutated.
 */
export function projectCurrentFormFields(
  parsed: ParsedFormSchema,
  fields: readonly CurrentFormDatasetField[],
  options: ProjectCurrentFormFieldsOptions = {},
): ProjectedFormFields {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const usedFieldIds = new Set<string>();
  const projectedProperties: Record<FormItemId, JsonSchemaObject> = {};
  const fieldsByItemId = new Map<FormItemId, CurrentFormDatasetField>();
  const choiceOptions: Record<FormItemId, DatasetChoiceOption[]> = {};
  const configurationInvalidItemIds: FormItemId[] = [];

  parsed.items.forEach((item) => {
    const field = fieldsById.get(item.extension.datasetFieldId);
    if (!field
      || field.archivedAt !== null
      || field.datasetId !== parsed.rootExtension.datasetId
      || field.isSystemManaged) {
      throw new TypeError(`Invalid current Dataset field mapping for Form item: ${item.id}`);
    }
    if (usedFieldIds.has(field.id)) {
      throw new TypeError(`Dataset field is mapped more than once: ${field.id}`);
    }
    usedFieldIds.add(field.id);
    fieldsByItemId.set(item.id, field);

    const choiceField = field.kind === 'single_select' || field.kind === 'multi_select';
    const choiceConfig = choiceField
      ? normalizeDatasetChoiceConfig(field.kind, field.config)
      : null;
    const authorProperty = choiceConfig?.hasOptions
      ? stripChoiceMembershipSchema(item.property) as JsonSchemaObject
      : cloneJson(item.property);
    const datasetConstraint = choiceConfig?.hasOptions
      ? stripChoiceMembershipSchema(field.valueSchema)
      : cloneJson(field.valueSchema);
    const property = cloneJson(authorProperty);

    if (field.kind === 'relation') {
      if (field.relationCardinality === 'one') {
        appendAllOfConstraint(property, { type: 'string' });
      } else if (field.relationCardinality === 'many') {
        appendAllOfConstraint(property, {
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
        });
      } else {
        throw new TypeError(`Relation cardinality is missing for Form item: ${item.id}`);
      }
    } else {
      appendAllOfConstraint(property, datasetConstraint);
    }

    if (choiceConfig?.hasOptions) {
      const resolvedOptions = resolveDatasetChoiceLabels(
        choiceConfig.options,
        options.locale ?? 'zh-CN',
      );
      choiceOptions[item.id] = resolvedOptions;
      if (choiceConfig.optionMode === 'cascader') {
        projectCascaderChoice(property, choiceConfig.options);
        if (item.required && enumerateChoiceLeafPaths(choiceConfig.options).length === 0) {
          configurationInvalidItemIds.push(item.id);
        }
      } else {
        projectFlatChoice(property, field.kind as 'multi_select' | 'single_select', choiceConfig.options);
        if (item.required && choiceConfig.options.length === 0) {
          configurationInvalidItemIds.push(item.id);
        }
      }
    } else if (choiceField) {
      choiceOptions[item.id] = getChoiceOptions(item.property).flatMap((choice) => (
        typeof choice.value === 'string'
          ? [{ label: choice.label, value: choice.value }]
          : []
      ));
    }
    projectedProperties[item.id] = property;
  });

  const schema = cloneJson(parsed.schema);
  schema.properties = projectedProperties;
  return {
    choiceOptions,
    configurationInvalidItemIds,
    fieldsByItemId,
    schema,
  };
}

function validateDefault(
  runtimeSchema: JsonSchemaObject,
  itemId: FormItemId,
  value: JsonValue,
): readonly ErrorObject[] {
  const property = isRecord(runtimeSchema.properties)
    ? runtimeSchema.properties[itemId]
    : undefined;
  const schema: JsonSchemaObject = {
    type: 'object',
    additionalProperties: false,
    properties: property === undefined ? {} : { [itemId]: cloneJson(property) },
    required: [itemId],
    ...(runtimeSchema.$defs !== undefined && { $defs: cloneJson(runtimeSchema.$defs) }),
  };
  const validate = defaultAjv.compile(schema);
  return validate({ [itemId]: cloneJson(value) })
    ? []
    : cloneJson(validate.errors ?? []);
}

/** Evaluate visibility, hidden clearing and valid defaults once in dependency order. */
export function evaluateFormAnswers(
  input: EvaluateFormAnswersInput,
): EvaluatedFormAnswers {
  const declaredIds = new Set(input.parsed.items.map((item) => item.id));
  const originalKeys = Object.keys(input.inputAnswers);
  const originalKeySet = new Set(originalKeys);
  const unknownItemIds = originalKeys.filter((itemId) => !declaredIds.has(itemId));
  const working: Record<FormItemId, JsonValue> = {};
  input.parsed.items.forEach((item) => {
    const value = input.inputAnswers[item.id];
    if (value !== undefined) working[item.id] = cloneJson(value);
  });
  const visibleItemIds: FormItemId[] = [];
  const hiddenSubmittedItemIds: FormItemId[] = [];
  const defaultDiagnostics: FormDefaultDiagnostic[] = [];

  input.parsed.topologicalItems.forEach((item) => {
    if (!isItemVisible(item.extension, working)) {
      if (input.rejectExplicitHidden && originalKeySet.has(item.id)) {
        hiddenSubmittedItemIds.push(item.id);
      }
      delete working[item.id];
      return;
    }
    visibleItemIds.push(item.id);
    if (Object.hasOwn(working, item.id)) return;
    const defaultValue = getPropertyDefault(item.property);
    if (defaultValue === undefined) return;
    const errors = validateDefault(input.runtimeSchema, item.id, defaultValue);
    if (errors.length > 0) {
      defaultDiagnostics.push({ errors, itemId: item.id });
      return;
    }
    working[item.id] = cloneJson(defaultValue);
  });

  const visibleSet = new Set(visibleItemIds);
  const runtimeProperties = isRecord(input.runtimeSchema.properties)
    ? input.runtimeSchema.properties
    : {};
  const effectiveSchema = cloneJson(input.runtimeSchema);
  effectiveSchema.properties = Object.fromEntries(input.parsed.items.flatMap((item) => (
    visibleSet.has(item.id) && runtimeProperties[item.id] !== undefined
      ? [[item.id, runtimeProperties[item.id] as JsonValue]]
      : []
  )));
  effectiveSchema.required = input.parsed.items
    .filter((item) => item.required && visibleSet.has(item.id))
    .map((item) => item.id);

  return {
    answers: working,
    defaultDiagnostics,
    effectiveSchema,
    hiddenSubmittedItemIds,
    unknownItemIds,
    visibleItemIds,
  };
}
