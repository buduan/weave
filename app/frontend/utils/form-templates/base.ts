import type { DatasetFieldDefinition, FormWidget, JsonSchemaObject } from '@weave/types';
import type { FormTemplateCreateContext } from './types';

function propertyShape(
  field: DatasetFieldDefinition | undefined,
  widget: FormWidget,
): JsonSchemaObject {
  if (widget === 'checkbox') return { type: 'boolean' };
  if (widget === 'cascader' || widget === 'tags-input') {
    return { type: 'array', items: { type: 'string' } };
  }
  if (field && widget === 'selector' && (
    field.kind === 'multi_select'
    || (field.kind === 'relation' && field.relationCardinality === 'many')
  )) {
    return { type: 'array', items: { type: 'string' }, uniqueItems: true };
  }
  if (field?.kind === 'number') return { type: 'number' };
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
  const relationOptions = datasetField?.kind === 'relation'
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

export function isFlatChoice(field: DatasetFieldDefinition): boolean {
  return field.config.optionMode !== 'cascader';
}
