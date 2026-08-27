import type {
  DatasetFieldDataType,
  DatasetFieldKind,
  FormWidget,
  JsonSchema,
  JsonSchemaObject,
} from '@weave/types';

/** Prisma 不能用 `string[]` 作枚举值，落库为 `string_array`。 */
export type PrismaDatasetFieldDataType = Exclude<DatasetFieldDataType, 'string[]'> | 'string_array';

const KIND_DATA_TYPE: Record<DatasetFieldKind, DatasetFieldDataType> = {
  cascader: 'string[]',
  checkbox: 'boolean',
  currency: 'number',
  date: 'string',
  datetime: 'string',
  email: 'string',
  json: 'json',
  long_text: 'string',
  multi_select: 'string[]',
  number: 'number',
  percent: 'number',
  relation: 'relation',
  single_select: 'string[]',
  tags: 'string[]',
  text: 'string',
  time: 'string',
  url: 'string',
};

const STRING_FORMATS: Partial<Record<DatasetFieldKind, string>> = {
  date: 'date',
  datetime: 'date-time',
  email: 'email',
  time: 'time',
  url: 'uri',
};

/** widget → 可绑定的存储类型。 */
export const formWidgetDataTypes: Record<FormWidget, readonly DatasetFieldDataType[]> = {
  cascader: ['string[]'],
  checkbox: ['boolean'],
  input: ['string', 'number'],
  radio: ['string[]'],
  selector: ['string[]', 'relation'],
  'tags-input': ['string[]'],
  textarea: ['string'],
};

/** 从调色板新建列时的默认外显。 */
export const defaultKindForWidget: Record<FormWidget, DatasetFieldKind> = {
  cascader: 'cascader',
  checkbox: 'checkbox',
  input: 'text',
  radio: 'single_select',
  selector: 'single_select',
  'tags-input': 'tags',
  textarea: 'long_text',
};

const CHOICE_KINDS = new Set<DatasetFieldKind>([
  'cascader',
  'multi_select',
  'single_select',
]);

export function dataTypeOfKind(kind: DatasetFieldKind): DatasetFieldDataType {
  return KIND_DATA_TYPE[kind];
}

export function toApiDataType(value: PrismaDatasetFieldDataType): DatasetFieldDataType {
  return value === 'string_array' ? 'string[]' : value;
}

export function toPrismaDataType(value: DatasetFieldDataType): PrismaDatasetFieldDataType {
  return value === 'string[]' ? 'string_array' : value;
}

/** 历史 kind（含已删除的 `boolean`）→ dataType；未知值兜底 string。 */
export function dataTypeOfLegacyKind(kind: string): DatasetFieldDataType {
  if (kind === 'number' || kind === 'percent' || kind === 'currency') return 'number';
  if (kind === 'boolean' || kind === 'checkbox') return 'boolean';
  if (
    kind === 'single_select'
    || kind === 'multi_select'
    || kind === 'cascader'
    || kind === 'tags'
  ) return 'string[]';
  if (kind === 'json') return 'json';
  if (kind === 'relation') return 'relation';
  return 'string';
}

export function kindsForDataType(dataType: DatasetFieldDataType): DatasetFieldKind[] {
  return (Object.keys(KIND_DATA_TYPE) as DatasetFieldKind[])
    .filter((kind) => KIND_DATA_TYPE[kind] === dataType);
}

export function isChoiceKind(kind: DatasetFieldKind): boolean {
  return CHOICE_KINDS.has(kind);
}

export function isStringArrayDataType(dataType: DatasetFieldDataType): boolean {
  return dataType === 'string[]';
}

export function widgetAcceptsDataType(
  widget: FormWidget,
  dataType: DatasetFieldDataType,
): boolean {
  return formWidgetDataTypes[widget].includes(dataType);
}

export function valueSchemaForField(kind: DatasetFieldKind): JsonSchema {
  const dataType = dataTypeOfKind(kind);
  if (dataType === 'boolean') return { type: 'boolean' };
  if (dataType === 'number') {
    if (kind === 'percent') {
      return { type: ['number', 'null'], minimum: 0, maximum: 1 } as JsonSchemaObject;
    }
    return { type: ['number', 'null'] } as JsonSchemaObject;
  }
  if (dataType === 'string[]') {
    const schema: JsonSchemaObject = { type: 'array', items: { type: 'string' } };
    if (kind === 'single_select') schema.maxItems = 1;
    if (kind === 'multi_select' || kind === 'tags') schema.uniqueItems = true;
    return schema;
  }
  if (dataType === 'json' || dataType === 'relation') return {};
  const format = STRING_FORMATS[kind];
  return {
    type: ['string', 'null'],
    ...(format ? { format } : {}),
  } as JsonSchemaObject;
}

/** 长度为 0/1 的 string[] 解成标量，供 availableIf 旧字面量比较。 */
export function unwrapSingletonArray(value: unknown): unknown {
  if (!Array.isArray(value) || value.length > 1) return value;
  return value[0] ?? null;
}
