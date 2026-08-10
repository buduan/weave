import type {
  AvailableIfExpression,
  DatasetFieldDefinition,
  DatasetFieldKind,
  FormDraftDefinitionInput,
  FormItemId,
  FormItemUiOptions,
  FormWidget,
  JsonObject,
  JsonSchemaObject,
  JsonValue,
  LocalizedText,
} from '@weave/types';
import {
  cloneJson,
  createFormItemId,
  parseFormSchema,
  resolveLocalizedText,
  validateFormSchemaExtensions,
} from '@weave/utils';
import { orderFormLocales } from './form-locales';
import {
  getFormItemTemplate,
  type FormItemTemplate,
} from './form-templates/registry';

type FormI18nKey = 'description' | 'placeholder' | 'title';

function asSchemaObject(value: unknown): JsonSchemaObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonSchemaObject
    : null;
}

function getRootI18n(schema: JsonSchemaObject): Record<FormI18nKey, LocalizedText> {
  const root = schema['x-form'] as Record<string, unknown>;
  root.i18n ??= {};
  return root.i18n as Record<FormI18nKey, LocalizedText>;
}

export function getFormProperty(
  schema: JsonSchemaObject,
  fieldId: string,
): JsonSchemaObject | null {
  const properties = asSchemaObject(schema.properties);
  return properties ? asSchemaObject(properties[fieldId]) : null;
}

function getPropertyI18n(property: JsonSchemaObject): Record<FormI18nKey, LocalizedText> {
  const extension = property['x-form'] as Record<string, unknown>;
  extension.i18n ??= {};
  return extension.i18n as Record<FormI18nKey, LocalizedText>;
}

export function collectFormLocales(definition: FormDraftDefinitionInput): string[] {
  const locales = new Set<string>([
    definition.defaultLocale,
    ...Object.keys(definition.nameI18n),
    ...Object.keys(definition.descriptionI18n ?? {}),
    ...Object.keys(definition.closingMessageI18n ?? {}),
  ]);
  const root = definition.schema['x-form'] as Record<string, unknown> | undefined;
  const rootI18n = root?.i18n as Record<string, LocalizedText> | undefined;
  Object.values(rootI18n ?? {}).forEach((map) => Object.keys(map).forEach((locale) => {
    locales.add(locale);
  }));
  const properties = asSchemaObject(definition.schema.properties) ?? {};
  Object.values(properties).forEach((rawProperty) => {
    const property = asSchemaObject(rawProperty);
    if (!property) return;
    const extension = property['x-form'] as Record<string, unknown> | undefined;
    const i18n = extension?.i18n as Record<string, LocalizedText> | undefined;
    Object.values(i18n ?? {}).forEach((map) => Object.keys(map).forEach((locale) => {
      locales.add(locale);
    }));
    if (!Array.isArray(property.oneOf)) return;
    property.oneOf.forEach((rawChoice) => {
      const choice = asSchemaObject(rawChoice);
      const choiceExtension = choice?.['x-form'] as Record<string, unknown> | undefined;
      const choiceI18n = choiceExtension?.i18n as Record<string, LocalizedText> | undefined;
      Object.values(choiceI18n ?? {}).forEach((map) => Object.keys(map).forEach((locale) => {
        locales.add(locale);
      }));
    });
  });
  return orderFormLocales(definition.defaultLocale, locales);
}

export function addFormLocale(definition: FormDraftDefinitionInput, locale: string): void {
  const fallback = resolveLocalizedText(
    definition.nameI18n,
    definition.defaultLocale,
    definition.defaultLocale,
  ) ?? '';
  const { nameI18n } = definition;
  nameI18n[locale] ??= fallback;
  const rootI18n = getRootI18n(definition.schema);
  rootI18n.title ??= {};
  rootI18n.title[locale] ??= resolveLocalizedText(
    rootI18n.title,
    definition.defaultLocale,
    definition.defaultLocale,
  ) ?? fallback;
}

export function setFormTitle(
  definition: FormDraftDefinitionInput,
  locale: string,
  value: string,
): void {
  const { nameI18n } = definition;
  nameI18n[locale] = value;
  const i18n = getRootI18n(definition.schema);
  i18n.title ??= {};
  i18n.title[locale] = value;
}

export function setFormDefaultLocale(
  definition: FormDraftDefinitionInput,
  locale: string,
): void {
  const previous = definition.defaultLocale;
  const ensure = (map: LocalizedText | undefined): void => {
    if (!map || Object.hasOwn(map, locale)) return;
    Object.assign(map, { [locale]: resolveLocalizedText(map, previous, previous) ?? '' });
  };
  ensure(definition.nameI18n);
  ensure(definition.descriptionI18n);
  ensure(definition.closingMessageI18n);
  const root = definition.schema['x-form'] as Record<string, unknown> | undefined;
  const rootI18n = root?.i18n as Record<string, LocalizedText> | undefined;
  Object.values(rootI18n ?? {}).forEach(ensure);
  Object.values(asSchemaObject(definition.schema.properties) ?? {}).forEach((rawProperty) => {
    const property = asSchemaObject(rawProperty);
    const extension = property?.['x-form'] as Record<string, unknown> | undefined;
    const i18n = extension?.i18n as Record<string, LocalizedText> | undefined;
    Object.values(i18n ?? {}).forEach(ensure);
  });
  Object.assign(definition, { defaultLocale: locale });
}

export function setFieldLocalizedText(
  schema: JsonSchemaObject,
  fieldId: string,
  key: FormI18nKey,
  locale: string,
  value: string,
): void {
  const property = getFormProperty(schema, fieldId);
  if (!property) return;
  const i18n = getPropertyI18n(property);
  if (value.length > 0 || key === 'placeholder') {
    i18n[key] ??= {};
    i18n[key][locale] = value;
    return;
  }
  delete i18n[key]?.[locale];
  if (i18n[key] && Object.keys(i18n[key]).length === 0) delete i18n[key];
  if (Object.keys(i18n).length === 0) {
    const extension = property['x-form'] as Record<string, unknown>;
    delete extension.i18n;
  }
}

export function setChoiceLocalizedTitle(
  schema: JsonSchemaObject,
  fieldId: string,
  index: number,
  locale: string,
  value: string,
): void {
  const property = getFormProperty(schema, fieldId);
  const choice = property && Array.isArray(property.oneOf)
    ? asSchemaObject(property.oneOf[index])
    : null;
  if (!choice) return;
  const extension = choice['x-form'] as Record<string, unknown>;
  extension.i18n ??= {};
  const i18n = extension.i18n as Record<'title', LocalizedText>;
  i18n.title ??= {};
  i18n.title[locale] = value;
}

export function setFormLocalizedMetadata(
  definition: FormDraftDefinitionInput,
  key: 'closingMessageI18n' | 'descriptionI18n',
  locale: string,
  value: string,
): void {
  const map = definition[key] ?? {};
  if (value.length > 0) map[locale] = value;
  else delete map[locale];
  if (Object.keys(map).length > 0) Object.assign(definition, { [key]: map });
  else Reflect.deleteProperty(definition, key);
}

export function isFormItemRequired(schema: JsonSchemaObject, fieldId: string): boolean {
  return Array.isArray(schema.required) && schema.required.includes(fieldId);
}

export function setFormItemRequired(
  schema: JsonSchemaObject,
  fieldId: string,
  required: boolean,
): void {
  const itemIds = new Set(Object.keys(asSchemaObject(schema.properties) ?? {}));
  if (required && !itemIds.has(fieldId)) return;
  const next = Array.isArray(schema.required)
    ? schema.required.filter((id): id is string => typeof id === 'string' && itemIds.has(id))
    : [];
  const without = next.filter((id) => id !== fieldId);
  if (required) without.push(fieldId);
  if (without.length > 0) Object.assign(schema, { required: without });
  else Reflect.deleteProperty(schema, 'required');
}

export type FormConstraintKey =
  | 'format'
  | 'maxItems'
  | 'maxLength'
  | 'maximum'
  | 'minItems'
  | 'minLength'
  | 'minimum'
  | 'multipleOf'
  | 'pattern'
  | 'uniqueItems';

export function setFormItemConstraint(
  schema: JsonSchemaObject,
  fieldId: string,
  key: FormConstraintKey,
  value: JsonValue | undefined,
): void {
  const property = getFormProperty(schema, fieldId);
  if (!property) return;
  if (value === undefined || value === '') delete property[key];
  else property[key] = value;
}

export function setFormItemDefault(
  schema: JsonSchemaObject,
  fieldId: string,
  value: JsonValue | undefined,
): void {
  const property = getFormProperty(schema, fieldId);
  if (!property) return;
  if (value === undefined) delete property.default;
  else property.default = value;
}

export function setFormItemAvailableIf(
  schema: JsonSchemaObject,
  fieldId: string,
  expression: AvailableIfExpression | undefined,
): void {
  const property = getFormProperty(schema, fieldId);
  const extension = property?.['x-form'] as Record<string, unknown> | undefined;
  if (!extension) return;
  if (expression) extension.availableIf = expression as unknown as JsonValue;
  else delete extension.availableIf;
}

export function setFormItemRelationOptions(
  schema: JsonSchemaObject,
  fieldId: string,
  options: FormItemUiOptions | undefined,
): void {
  const property = getFormProperty(schema, fieldId);
  const extension = property?.['x-form'] as Record<string, unknown> | undefined;
  if (!extension) return;
  const ui = (extension.ui ??= {}) as Record<string, unknown>;
  if (options && Object.keys(options).length > 0) {
    ui.options = JSON.parse(JSON.stringify(options)) as JsonValue;
  } else {
    delete ui.options;
  }
}

export function resolveFormItemTemplate(
  schema: JsonSchemaObject,
  fieldId: string,
): FormItemTemplate | null {
  try {
    const item = parseFormSchema(schema, { mode: 'legacy' }).items
      .find((candidate) => candidate.id === fieldId);
    return item ? getFormItemTemplate(item.widget) : null;
  } catch {
    return null;
  }
}

function withPositionedEntries(
  schema: JsonSchemaObject,
  entries: Array<[string, JsonSchemaObject]> | Array<readonly [string, JsonSchemaObject]>,
): JsonSchemaObject {
  const next = cloneJson(schema);
  next.properties = Object.fromEntries(entries.map(([id, rawProperty], position) => {
    const property = cloneJson(rawProperty);
    const extension = property['x-form'] as Record<string, unknown>;
    extension.position = position;
    return [id, property];
  }));
  return next;
}

export function appendFormItem(
  schema: JsonSchemaObject,
  template: FormItemTemplate,
  datasetField: DatasetFieldDefinition | undefined,
  locale: string,
  afterId?: string | null,
): { fieldId: FormItemId; schema: JsonSchemaObject } {
  if (datasetField && !template.accepts(datasetField)) {
    throw new TypeError(`${template.label} 与数据集字段 ${datasetField.name} 不兼容。`);
  }
  const next = cloneJson(schema);
  const properties = asSchemaObject(next.properties) ?? {};
  const entries = Object.entries(properties) as Array<[string, JsonSchemaObject]>;
  const selectedIndex = afterId ? entries.findIndex(([id]) => id === afterId) : -1;
  const fieldId = createFormItemId();
  entries.splice(selectedIndex < 0 ? entries.length : selectedIndex + 1, 0, [
    fieldId,
    template.createProperty({
      datasetField,
      datasetFieldId: datasetField?.id ?? fieldId,
      locale,
      position: 0,
      title: template.label,
    }),
  ]);
  return { fieldId, schema: withPositionedEntries(next, entries) };
}

export function createDatasetFieldConfig(
  widget: FormWidget,
  kind: DatasetFieldKind,
): JsonObject {
  if (kind !== 'single_select' && kind !== 'multi_select') return {};
  if (widget === 'tags-input') return {};
  return {
    optionMode: widget === 'cascader' ? 'cascader' : 'flat',
    options: [],
  };
}

export function rebindFormItem(
  schema: JsonSchemaObject,
  fieldId: string,
  datasetField: DatasetFieldDefinition,
  locale: string,
): JsonSchemaObject {
  const parsed = parseFormSchema(schema, { mode: 'legacy' });
  const item = parsed.items.find((candidate) => candidate.id === fieldId);
  if (!item) throw new TypeError('找不到要绑定的表单项。');
  const template = getFormItemTemplate(item.widget);
  if (!template.accepts(datasetField)) {
    throw new TypeError(`${template.label} 与数据集字段 ${datasetField.name} 不兼容。`);
  }
  const replacement = template.createProperty({
    datasetField,
    locale,
    position: item.position,
  });
  const sourceExtension = item.property['x-form'] as Record<string, unknown>;
  const replacementExtension = replacement['x-form'] as Record<string, unknown>;
  if (sourceExtension.i18n) replacementExtension.i18n = cloneJson(sourceExtension.i18n);
  if (!template.settings.placeholder) {
    const i18n = replacementExtension.i18n as Record<string, unknown> | undefined;
    if (i18n) delete i18n.placeholder;
  }
  if (sourceExtension.availableIf) {
    replacementExtension.availableIf = cloneJson(sourceExtension.availableIf);
  }
  if (template.settings.relation) {
    const sourceUi = sourceExtension.ui as Record<string, unknown> | undefined;
    const sourceOptions = sourceUi?.options as Record<string, unknown> | undefined;
    const nextUi = replacementExtension.ui as Record<string, unknown>;
    const nextOptions = nextUi.options as Record<string, unknown> | undefined;
    if (sourceOptions?.filter && nextOptions) nextOptions.filter = cloneJson(sourceOptions.filter);
  }
  const preservedKeys: FormConstraintKey[] = [];
  if (template.settings.string) preservedKeys.push('format', 'maxLength', 'minLength', 'pattern');
  if (template.settings.numeric) preservedKeys.push('maximum', 'minimum', 'multipleOf');
  if (template.settings.array) preservedKeys.push('maxItems', 'minItems', 'uniqueItems');
  if (template.settings.default) {
    if (Object.hasOwn(item.property, 'default') && item.property.default !== undefined) {
      replacement.default = item.property.default;
    }
  }
  preservedKeys.forEach((key) => {
    if (Object.hasOwn(item.property, key)) replacement[key] = item.property[key] as JsonValue;
  });
  const next = cloneJson(schema);
  const properties = asSchemaObject(next.properties) ?? {};
  properties[fieldId] = replacement;
  next.properties = properties;
  return next;
}

export function moveFormItem(
  schema: JsonSchemaObject,
  fieldId: string,
  offset: -1 | 1,
): JsonSchemaObject {
  const parsed = parseFormSchema(schema, { mode: 'legacy' });
  const entries = parsed.items.map((item) => [item.id, cloneJson(item.property)] as const);
  const from = entries.findIndex(([id]) => id === fieldId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= entries.length) return cloneJson(schema);
  const [entry] = entries.splice(from, 1);
  if (entry) entries.splice(to, 0, entry);
  return withPositionedEntries(schema, entries);
}

export function referencedByFormItems(schema: JsonSchemaObject, fieldId: string): FormItemId[] {
  return parseFormSchema(schema, { mode: 'legacy' }).items
    .filter((item) => item.id !== fieldId && item.dependencies.includes(fieldId))
    .map((item) => item.id);
}

export function duplicateFormItem(
  schema: JsonSchemaObject,
  fieldId: string,
): { fieldId: FormItemId; schema: JsonSchemaObject } {
  const parsed = parseFormSchema(schema, { mode: 'legacy' });
  const entries = parsed.items.map((item) => [item.id, cloneJson(item.property)] as const);
  const index = entries.findIndex(([id]) => id === fieldId);
  if (index < 0) throw new TypeError('找不到要复制的表单项。');
  const source = entries[index]?.[1];
  if (!source) throw new TypeError('找不到要复制的表单项。');
  const nextId = createFormItemId();
  const copy = cloneJson(source);
  const extension = copy['x-form'] as Record<string, unknown>;
  extension.datasetFieldId = 'unbound';
  delete extension.availableIf;
  const ui = extension.ui as Record<string, unknown> | undefined;
  const options = ui?.options as Record<string, unknown> | undefined;
  if (options) delete options.filter;
  entries.splice(index + 1, 0, [nextId, copy]);
  const next = withPositionedEntries(schema, entries);
  setFormItemRequired(next, nextId, false);
  return { fieldId: nextId, schema: next };
}

export function deleteFormItem(
  schema: JsonSchemaObject,
  fieldId: string,
): { references: FormItemId[]; schema: JsonSchemaObject; selectedFieldId: FormItemId | null } {
  const parsed = parseFormSchema(schema, { mode: 'legacy' });
  const references = referencedByFormItems(schema, fieldId);
  if (references.length > 0) {
    return { references, schema: cloneJson(schema), selectedFieldId: fieldId };
  }
  const index = parsed.items.findIndex((item) => item.id === fieldId);
  const remaining = parsed.items.filter((item) => item.id !== fieldId);
  const next = cloneJson(schema);
  const positioned = withPositionedEntries(next, remaining.map((item) => [item.id, item.property]));
  setFormItemRequired(positioned, fieldId, false);
  const adjacent = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
  return { references: [], schema: positioned, selectedFieldId: adjacent };
}

export function validateFormEditorSchema(
  schema: JsonSchemaObject,
  dataset?: DatasetPanelLike | null,
): void {
  const parsed = parseFormSchema(schema, { mode: 'strict' });
  if (!dataset) return;
  const fields = new Map(dataset.fields.map((field) => [field.id, field]));
  parsed.items.forEach((item) => {
    const field = fields.get(item.extension.datasetFieldId);
    if (!field) throw new TypeError(`表单项 ${item.id} 必须绑定当前有效的数据集字段。`);
    const template = getFormItemTemplate(item.widget);
    if (!template.accepts(field)) {
      throw new TypeError(`表单项 ${item.id} 的控件与数据集字段类型不兼容。`);
    }
    if (template.settings.placeholder && !item.extension.i18n?.placeholder) {
      throw new TypeError(`表单项 ${item.id} 缺少占位文案。`);
    }
  });
}

interface DatasetPanelLike {
  fields: DatasetFieldDefinition[];
}

export function parseAndValidateFormSource(source: string): JsonSchemaObject {
  const parsed = JSON.parse(source) as unknown;
  const schema = asSchemaObject(parsed);
  if (!schema || schema.type !== 'object' || schema.additionalProperties !== false) {
    throw new TypeError('Form Schema 必须是 type=object 且 additionalProperties=false 的对象。');
  }
  validateFormSchemaExtensions(schema);
  return schema;
}
