import type {
  DatasetFieldDataType,
  DatasetFieldDefinition,
  FormWidget,
  JsonSchemaObject,
} from '@weave/types';
import { dataTypeOfKind, defaultKindForWidget } from '@weave/utils';
import type { FormTemplateCreateContext } from './types';

function propertyShape(
  field: DatasetFieldDefinition | undefined,
  widget: FormWidget,
): JsonSchemaObject {
  const dataType: DatasetFieldDataType = field?.dataType
    ?? dataTypeOfKind(defaultKindForWidget[widget]);
  if (dataType === 'boolean') return { type: 'boolean' };
  if (dataType === 'number') return { type: 'number' };
  if (dataType === 'string[]') {
    const schema: JsonSchemaObject = { type: 'array', items: { type: 'string' } };
    if (widget === 'radio' || field?.kind === 'single_select') schema.maxItems = 1;
    if (widget === 'selector' && field?.kind !== 'single_select') schema.uniqueItems = true;
    return schema;
  }
  if (dataType === 'relation') {
    if (field?.relationCardinality === 'many') {
      return { type: 'array', items: { type: 'string' }, uniqueItems: true };
    }
    return { type: 'string' };
  }
  const formats: Partial<Record<DatasetFieldDefinition['kind'], string>> = {
    date: 'date',
    datetime: 'date-time',
    email: 'email',
    time: 'time',
    url: 'uri',
  };
  return {
    type: 'string',
    ...(field && formats[field.kind] && { format: formats[field.kind] }),
  };
}

export function createTemplateProperty(
  widget: FormWidget,
  context: FormTemplateCreateContext,
  placeholderDefault?: string,
): JsonSchemaObject {
  const {
    datasetField, datasetFieldId, locale, position, title,
  } = context;
  const bindingId = datasetField?.id ?? datasetFieldId;
  if (!bindingId) throw new TypeError('Form template requires a Dataset field binding');
  const rawConfig = (datasetField?.config ?? {}) as Record<string, unknown>;
  const relationOptions = datasetField?.dataType === 'relation'
    && typeof rawConfig.labelFieldId === 'string'
    ? { labelFieldId: rawConfig.labelFieldId }
    : undefined;
  return {
    ...propertyShape(datasetField, widget),
    'x-form': {
      datasetFieldId: bindingId,
      position,
      i18n: {
        title: { [locale]: datasetField?.name ?? title ?? '新增表单项' },
        ...(placeholderDefault && { placeholder: { [locale]: placeholderDefault } }),
      },
      ui: {
        widget,
        ...(relationOptions && { options: relationOptions }),
      },
    },
  } as unknown as JsonSchemaObject;
}
