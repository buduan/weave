import type {
  FormItemExtension,
  FormItemId,
  FormRootExtension,
  FormWidget,
  JsonSchema,
  JsonSchemaObject,
  JsonValue,
  LocalizedText,
  RelationFilterExpression,
  RelationFilterOperator,
  AvailableIfExpression,
} from '@weave/types';
import { formWidgets, relationFilterOperators } from '@weave/types';

import { evaluateAvailableIf, parseAvailableIf } from './visible-if';
import { cloneJson } from './json-clone';
import { isRecord } from './json-guards';

/** Form item ID 格式：q_ + UUID v4。 */
const formItemIdPattern = /^q_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const filterOperators = new Set<RelationFilterOperator>(relationFilterOperators);
const registeredWidgets = new Set<string>(formWidgets);
const legacyWidgetAliases: Readonly<Record<string, FormWidget>> = {
  'dataset-select': 'selector',
  text: 'input',
};

export type FormSchemaParseMode = 'legacy' | 'strict';

export interface FormSchemaDiagnostic {
  code: 'legacy_position_fallback' | 'legacy_widget_alias';
  itemId?: FormItemId;
  level: 'warning';
  message: string;
  path: string;
}

export interface ParsedFormItem {
  dependencies: readonly FormItemId[];
  extension: FormItemExtension;
  id: FormItemId;
  position: number;
  property: JsonSchemaObject;
  required: boolean;
  widget: FormWidget;
}

export interface ParsedFormSchema {
  diagnostics: readonly FormSchemaDiagnostic[];
  items: readonly ParsedFormItem[];
  properties: Readonly<Record<FormItemId, JsonSchemaObject>>;
  requiredItemIds: ReadonlySet<FormItemId>;
  rootExtension: FormRootExtension;
  schema: JsonSchemaObject;
  topologicalItems: readonly ParsedFormItem[];
}

export interface ParseFormSchemaOptions {
  mode?: FormSchemaParseMode;
}

/** oneOf 选项投影（框架无关）。 */
export interface FormChoiceOption {
  label: string;
  value: string | number;
}

/** 将 unknown 断言为 Record 类型。 */
function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

/** 断言对象仅包含指定 key。 */
function assertKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new TypeError(`Unknown ${name} property: ${unknown}`);
}

/** 断言值为非空字符串。 */
function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

/** 校验多语言文案 map：非空、locale 为非空字符串、值为字符串。 */
function validateLocaleMap(value: unknown, name: string): void {
  const map = asRecord(value, name);
  if (Object.keys(map).length === 0) throw new TypeError(`${name} must not be empty`);
  Object.entries(map).forEach(([locale, text]) => {
    assertString(locale, `${name} locale`);
    if (typeof text !== 'string') throw new TypeError(`${name}.${locale} must be a string`);
  });
}

/** 校验 Form item 的 i18n 扩展（title、description、placeholder）。 */
function validateI18n(value: unknown, name: string): void {
  const i18n = asRecord(value, name);
  assertKeys(i18n, ['description', 'placeholder', 'title'], name);
  Object.entries(i18n).forEach(([key, map]) => validateLocaleMap(map, `${name}.${key}`));
}

/** 校验单个关联筛选条件：操作符已注册、value 和 valueFrom 互斥。 */
function validateFilterCondition(value: unknown, itemIds: ReadonlySet<string>): void {
  const condition = asRecord(value, 'relation filter condition');
  assertKeys(condition, ['fieldId', 'operator', 'value', 'valueFrom'], 'relation filter');
  assertString(condition.fieldId, 'relation filter fieldId');
  if (!filterOperators.has(condition.operator as RelationFilterOperator)) {
    throw new TypeError(`Unknown relation filter operator: ${String(condition.operator)}`);
  }
  const hasValue = Object.hasOwn(condition, 'value');
  const hasValueFrom = Object.hasOwn(condition, 'valueFrom');
  if (hasValue && hasValueFrom) {
    throw new TypeError('relation filter cannot contain both value and valueFrom');
  }
  if (hasValueFrom) {
    assertString(condition.valueFrom, 'relation filter valueFrom');
    if (!itemIds.has(condition.valueFrom)) {
      throw new TypeError(`Unknown relation filter Form item: ${condition.valueFrom}`);
    }
  }
}

/** 校验关联筛选表达式：必须恰好包含 all 或 any 之一。 */
function validateFilter(value: unknown, itemIds: ReadonlySet<string>): void {
  const filter = asRecord(value, 'relation filter');
  assertKeys(filter, ['all', 'any'], 'relation filter');
  const groups = ['all', 'any'].filter((key) => Object.hasOwn(filter, key));
  if (groups.length !== 1) throw new TypeError('relation filter requires exactly one of all or any');
  const groupKey = groups[0] as 'all' | 'any';
  const conditions = filter[groupKey];
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new TypeError(`relation filter ${groupKey} must be a non-empty array`);
  }
  conditions.forEach((condition) => validateFilterCondition(condition, itemIds));
}

/** 校验 Form item 的 UI 配置（组件类型、关联选项等）。 */
function validateUi(
  value: unknown,
  itemIds: ReadonlySet<string>,
  mode: FormSchemaParseMode,
): void {
  const ui = asRecord(value, 'Form item ui');
  assertKeys(ui, ['options', 'widget'], 'Form item ui');
  if (ui.widget !== undefined) {
    assertString(ui.widget, 'Form item ui widget');
    const isRegistered = registeredWidgets.has(ui.widget);
    const isLegacyAlias = mode === 'legacy' && legacyWidgetAliases[ui.widget] !== undefined;
    if (!isRegistered && !isLegacyAlias) {
      throw new TypeError(`Unknown Form item ui widget: ${ui.widget}`);
    }
  }
  if (ui.options === undefined) return;
  const options = asRecord(ui.options, 'Form item options');
  assertKeys(options, ['filter', 'labelFieldId'], 'Form item options');
  if (options.labelFieldId !== undefined) {
    assertString(options.labelFieldId, 'Form item options labelFieldId');
  }
  if (options.filter !== undefined) validateFilter(options.filter, itemIds);
}

/** 递归收集 availableIf 表达式中引用的所有 fieldId。 */
function referencedAvailableIfFields(expression: AvailableIfExpression): string[] {
  if ('conditions' in expression) return expression.conditions.flatMap(referencedAvailableIfFields);
  if ('condition' in expression) return referencedAvailableIfFields(expression.condition);
  return [expression.fieldId];
}

/** 校验单个 Form item 的 x-form 扩展。 */
function validateItemExtension(
  value: unknown,
  itemIds: ReadonlySet<string>,
  mode: FormSchemaParseMode,
): void {
  const extension = asRecord(value, 'Form item x-form');
  assertKeys(
    extension,
    ['datasetFieldId', 'position', 'i18n', 'ui', 'availableIf'],
    'Form item x-form',
  );
  assertString(extension.datasetFieldId, 'Form item datasetFieldId');
  if (extension.position === undefined) {
    if (mode === 'strict') throw new TypeError('Form item position is required');
  } else if (!Number.isInteger(extension.position) || (extension.position as number) < 0) {
    throw new TypeError('Form item position must be a non-negative integer');
  }
  if (extension.i18n !== undefined) validateI18n(extension.i18n, 'Form item i18n');
  if (extension.ui !== undefined) validateUi(extension.ui, itemIds, mode);
  if (extension.availableIf !== undefined) {
    const expression = parseAvailableIf(extension.availableIf);
    // availableIf 引用的 Form item ID 必须存在。
    const missing = referencedAvailableIfFields(expression)
      .find((fieldId) => !itemIds.has(fieldId));
    if (missing) throw new TypeError(`Unknown availableIf Form item: ${missing}`);
  }
}

/** 校验设备采集设置：仅允许 browser、operatingSystem、userAgent 三个键。 */
function validateCapture(value: unknown): void {
  const capture = asRecord(value, 'Form capture');
  assertKeys(capture, ['browser', 'operatingSystem', 'userAgent'], 'Form capture');
  Object.entries(capture).forEach(([key, rawField]) => {
    const field = asRecord(rawField, `Form capture ${key}`);
    assertKeys(field, ['datasetFieldId'], `Form capture ${key}`);
    assertString(field.datasetFieldId, `Form capture ${key} datasetFieldId`);
  });
}

/** 校验 Form 根 x-form 扩展：版本号、datasetId、多语言文案和采集设置。 */
function validateRootExtension(value: unknown): void {
  const extension = asRecord(value, 'Form root x-form');
  assertKeys(extension, ['capture', 'datasetId', 'i18n', 'version'], 'Form root x-form');
  if (extension.version !== 1) throw new TypeError('Form root x-form version must be 1');
  assertString(extension.datasetId, 'Form root datasetId');
  validateCapture(extension.capture);
  if (extension.i18n !== undefined) validateI18n(extension.i18n, 'Form root i18n');
}

/** 校验 oneOf 选项的 x-form 扩展（i18n 文案）。 */
function validateChoiceExtensions(schema: Record<string, unknown>): void {
  if (!Array.isArray(schema.oneOf)) return;
  schema.oneOf.forEach((rawChoice) => {
    const choice = asRecord(rawChoice, 'Form choice');
    if (choice['x-form'] === undefined) return;
    const extension = asRecord(choice['x-form'], 'Form choice x-form');
    assertKeys(extension, ['i18n'], 'Form choice x-form');
    validateI18n(extension.i18n, 'Form choice i18n');
  });
}

/** Infer a renderer widget only when the standard Schema shape is unambiguous. */
function inferWidget(property: Record<string, unknown>, itemId: string): FormWidget {
  if (property.type === 'boolean') return 'checkbox';
  if (property.type === 'array') return 'tags-input';
  if (Array.isArray(property.oneOf) || Array.isArray(property.enum)) return 'selector';
  if (['integer', 'number', 'string'].includes(String(property.type))) return 'input';
  throw new TypeError(`Cannot infer Form item widget at /properties/${itemId}`);
}

function resolveWidget(
  extension: Record<string, unknown>,
  property: Record<string, unknown>,
  itemId: FormItemId,
  mode: FormSchemaParseMode,
  diagnostics: FormSchemaDiagnostic[],
): FormWidget {
  const ui = isRecord(extension.ui) ? extension.ui : undefined;
  if (typeof ui?.widget !== 'string') return inferWidget(property, itemId);
  if (registeredWidgets.has(ui.widget)) return ui.widget as FormWidget;
  const alias = mode === 'legacy' ? legacyWidgetAliases[ui.widget] : undefined;
  if (!alias) throw new TypeError(`Unknown Form item ui widget: ${ui.widget}`);
  diagnostics.push({
    code: 'legacy_widget_alias',
    itemId,
    level: 'warning',
    message: `Legacy widget ${ui.widget} is read as ${alias}`,
    path: `/properties/${itemId}/x-form/ui/widget`,
  });
  return alias;
}

function parseRequiredItemIds(
  required: unknown,
  itemIds: ReadonlySet<FormItemId>,
): Set<FormItemId> {
  if (required === undefined) return new Set();
  if (!Array.isArray(required)) throw new TypeError('Form Schema required must be an array');
  const result = new Set<FormItemId>();
  required.forEach((rawItemId, index) => {
    if (typeof rawItemId !== 'string') {
      throw new TypeError(`Form Schema required item at /required/${index} must be a string`);
    }
    if (!itemIds.has(rawItemId)) {
      throw new TypeError(`Unknown Form Schema required item: ${rawItemId}`);
    }
    if (result.has(rawItemId)) {
      throw new TypeError(`Duplicate Form Schema required item: ${rawItemId}`);
    }
    result.add(rawItemId);
  });
  return result;
}

function getItemDependencies(extension: FormItemExtension): FormItemId[] {
  const dependencies = extension.availableIf
    ? referencedAvailableIfFields(extension.availableIf)
    : [];
  return [...new Set([
    ...dependencies,
    ...getRelationFilterDependencies(extension.ui?.options?.filter),
  ])];
}

function sortParsedItems(items: readonly ParsedFormItem[]): ParsedFormItem[] {
  return [...items].sort((left, right) => (
    left.position - right.position || left.id.localeCompare(right.id)
  ));
}

function topologicallySortItems(items: readonly ParsedFormItem[]): ParsedFormItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const dependents = new Map<FormItemId, FormItemId[]>();
  const indegree = new Map<FormItemId, number>();
  items.forEach((item) => {
    indegree.set(item.id, item.dependencies.length);
    item.dependencies.forEach((dependencyId) => {
      const current = dependents.get(dependencyId) ?? [];
      current.push(item.id);
      dependents.set(dependencyId, current);
    });
  });

  const compareIds = (leftId: FormItemId, rightId: FormItemId): number => {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    if (!left || !right) return leftId.localeCompare(rightId);
    return left.position - right.position || left.id.localeCompare(right.id);
  };
  const ready = items
    .filter((item) => indegree.get(item.id) === 0)
    .map((item) => item.id)
    .sort(compareIds);
  const result: ParsedFormItem[] = [];

  while (ready.length > 0) {
    const itemId = ready.shift();
    if (!itemId) break;
    const item = byId.get(itemId);
    if (!item) continue;
    result.push(item);
    (dependents.get(itemId) ?? []).forEach((dependentId) => {
      const nextIndegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(dependentId);
        ready.sort(compareIds);
      }
    });
  }

  if (result.length !== items.length) {
    const cyclicIds = items
      .filter((item) => !result.some((resolved) => resolved.id === item.id))
      .map((item) => item.id)
      .sort(compareIds);
    throw new TypeError(`Cyclic Form item dependencies: ${cyclicIds.join(', ')}`);
  }
  return result;
}

/** Parse and validate one Form Schema into the canonical runtime representation. */
export function parseFormSchema(
  schema: JsonSchema,
  options: ParseFormSchemaOptions = {},
): ParsedFormSchema {
  const mode = options.mode ?? 'strict';
  const root = asRecord(schema, 'Form Schema');
  if (root.type !== 'object') throw new TypeError('Form Schema type must be object');
  const properties = asRecord(root.properties, 'Form Schema properties');
  const propertyEntries = Object.entries(properties);
  const itemIds = new Set<FormItemId>(propertyEntries.map(([itemId]) => itemId));
  const invalidId = [...itemIds].find((itemId) => !formItemIdPattern.test(itemId));
  if (invalidId) throw new TypeError(`Invalid Form item ID: ${invalidId}`);
  validateRootExtension(root['x-form']);
  const requiredItemIds = parseRequiredItemIds(root.required, itemIds);
  const diagnostics: FormSchemaDiagnostic[] = [];
  const rawExtensions = new Map<FormItemId, Record<string, unknown>>();

  propertyEntries.forEach(([itemId, rawProperty]) => {
    const property = asRecord(rawProperty, `Form item Schema at /properties/${itemId}`);
    if (property['x-form'] === undefined) {
      throw new TypeError(`Form item x-form is required at /properties/${itemId}`);
    }
    validateItemExtension(property['x-form'], itemIds, mode);
    validateChoiceExtensions(property);
    rawExtensions.set(itemId, asRecord(property['x-form'], 'Form item x-form'));
  });

  const hasMissingPosition = [...rawExtensions.values()]
    .some((extension) => extension.position === undefined);
  if (hasMissingPosition) {
    diagnostics.push({
      code: 'legacy_position_fallback',
      level: 'warning',
      message: 'Missing item positions were read from properties declaration order',
      path: '/properties',
    });
  }

  const parsedItems = propertyEntries.map(([itemId, rawProperty], index): ParsedFormItem => {
    const property = rawProperty as JsonSchemaObject;
    const rawExtension = rawExtensions.get(itemId);
    if (!rawExtension) throw new TypeError(`Form item x-form is required at /properties/${itemId}`);
    const position = hasMissingPosition ? index : rawExtension.position as number;
    const extension = { ...rawExtension, position } as unknown as FormItemExtension;
    const dependencies = getItemDependencies(extension);
    const selfDependency = dependencies.find((dependencyId) => dependencyId === itemId);
    if (selfDependency) throw new TypeError(`Form item cannot depend on itself: ${itemId}`);
    return {
      dependencies,
      extension,
      id: itemId,
      position,
      property,
      required: requiredItemIds.has(itemId),
      widget: resolveWidget(rawExtension, property, itemId, mode, diagnostics),
    };
  });

  if (!hasMissingPosition) {
    const sortedPositions = parsedItems.map((item) => item.position).sort((a, b) => a - b);
    sortedPositions.forEach((position, expected) => {
      if (position !== expected) {
        throw new TypeError('Form item positions must be unique and contiguous from 0');
      }
    });
  }

  const items = sortParsedItems(parsedItems);
  const topologicalItems = topologicallySortItems(parsedItems);
  return {
    diagnostics,
    items,
    properties: Object.fromEntries(items.map((item) => [item.id, item.property])),
    requiredItemIds,
    rootExtension: root['x-form'] as unknown as FormRootExtension,
    schema: root as JsonSchemaObject,
    topologicalItems,
  };
}

/** Return a copy whose item positions are contiguous in current render order. */
export function normalizeFormSchemaPositions(schema: JsonSchema): JsonSchemaObject {
  const parsed = parseFormSchema(schema, { mode: 'legacy' });
  const normalized = cloneJson(parsed.schema);
  const properties = normalized.properties as Record<FormItemId, JsonSchemaObject>;
  parsed.items.forEach((item, position) => {
    const property = properties[item.id] as JsonSchemaObject;
    property['x-form'] = {
      ...(property['x-form'] as Record<string, JsonValue>),
      position,
    };
  });
  return normalized;
}

/** Validate the strict write-time x-form contract. */
export function validateFormSchemaExtensions(
  schema: JsonSchema,
): asserts schema is JsonSchemaObject {
  parseFormSchema(schema, { mode: 'strict' });
}

// ---- 读路径（软解析，供渲染 / 提交映射；非法结构返回 null / 空值）----

/** 解析多语言文案：优先 locale，其次 fallbackLocale，最后取第一条非空文案。 */
export function resolveLocalizedText(
  map: LocalizedText | undefined,
  locale = 'zh-CN',
  fallbackLocale = 'zh-CN',
): string | undefined {
  if (!map) return undefined;
  if (typeof map[locale] === 'string' && map[locale].length > 0) return map[locale];
  if (
    typeof map[fallbackLocale] === 'string'
    && map[fallbackLocale].length > 0
  ) return map[fallbackLocale];
  return Object.values(map).find((value) => typeof value === 'string' && value.length > 0);
}

/** 读取 Form 根 x-form 扩展；结构不符时返回 null。 */
export function getRootExtension(schema: JsonSchema): FormRootExtension | null {
  if (!isRecord(schema)) return null;
  const extension = schema['x-form'];
  if (!isRecord(extension) || extension.version !== 1) return null;
  if (typeof extension.datasetId !== 'string' || !isRecord(extension.capture)) return null;
  return extension as unknown as FormRootExtension;
}

/** 读取 Form item 的 x-form 扩展。 */
export function getItemExtension(property: unknown): FormItemExtension | null {
  if (!isRecord(property)) return null;
  const extension = property['x-form'];
  if (!isRecord(extension) || typeof extension.datasetFieldId !== 'string') return null;
  return extension as unknown as FormItemExtension;
}

/** 读取 schema.properties 映射。 */
export function getSchemaProperties(
  schema: JsonSchema,
): Record<string, JsonSchemaObject> | null {
  if (!isRecord(schema) || !isRecord(schema.properties)) return null;
  return schema.properties as Record<string, JsonSchemaObject>;
}

/** 读取根 required 列表。 */
export function getRequiredItemIds(schema: JsonSchema): ReadonlySet<string> {
  if (!isRecord(schema) || !Array.isArray(schema.required)) return new Set();
  return new Set(schema.required.filter((id): id is string => typeof id === 'string'));
}

/** 从 oneOf const + choice i18n 推导选项列表。 */
export function getChoiceOptions(
  property: unknown,
  locale = 'zh-CN',
  fallbackLocale = 'zh-CN',
): FormChoiceOption[] {
  if (!isRecord(property)) return [];
  const choiceSchema = property.type === 'array' && isRecord(property.items)
    ? property.items
    : property;
  if (!Array.isArray(choiceSchema.oneOf)) {
    if (!Array.isArray(choiceSchema.enum)) return [];
    return choiceSchema.enum.flatMap((value): FormChoiceOption[] => (
      typeof value === 'string' || typeof value === 'number'
        ? [{ label: String(value), value }]
        : []
    ));
  }
  return choiceSchema.oneOf.flatMap((rawChoice) => {
    if (!isRecord(rawChoice) || rawChoice.const === undefined) return [];
    const value = rawChoice.const;
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    const extension = isRecord(rawChoice['x-form']) ? rawChoice['x-form'] : undefined;
    const i18n = extension && isRecord(extension.i18n) ? extension.i18n : undefined;
    const titleMap = i18n && isRecord(i18n.title) ? i18n.title as LocalizedText : undefined;
    const label = resolveLocalizedText(titleMap, locale, fallbackLocale) ?? String(value);
    return [{ label, value }];
  });
}

/** 判断 item 在当前 state 下是否可见。 */
export function isItemVisible(
  extension: FormItemExtension | null,
  state: Readonly<Record<string, JsonValue | undefined>>,
): boolean {
  if (!extension?.availableIf) return true;
  return evaluateAvailableIf(extension.availableIf, state);
}

/** Return submitted item IDs whose availableIf currently evaluates to false. */
export function findUnavailableSubmittedItemIds(
  schema: JsonSchema,
  answers: Readonly<Record<FormItemId, JsonValue | undefined>>,
): FormItemId[] {
  const properties = getSchemaProperties(schema);
  if (!properties) return [];
  return Object.keys(answers).filter((itemId) => {
    if (answers[itemId] === undefined) return false;
    const property = properties[itemId];
    return property !== undefined && !isItemVisible(getItemExtension(property), answers);
  });
}

/** Keep only declared Form items that are visible under the same answer snapshot. */
export function filterVisibleAnswers(
  schema: JsonSchema,
  answers: Readonly<Record<FormItemId, JsonValue | undefined>>,
): Record<FormItemId, JsonValue> {
  const properties = getSchemaProperties(schema);
  if (!properties) return {};
  return Object.fromEntries(
    Object.entries(answers).flatMap(([itemId, value]) => {
      const property = properties[itemId];
      if (
        value === undefined
        || property === undefined
        || !isItemVisible(getItemExtension(property), answers)
      ) return [];
      return [[itemId, value]];
    }),
  );
}

/** Extract the unique Form item dependencies declared by relation filter valueFrom. */
export function getRelationFilterDependencies(
  filter: RelationFilterExpression | undefined,
): FormItemId[] {
  if (!filter) return [];
  const conditions = filter.all ?? filter.any ?? [];
  return [...new Set(conditions.flatMap((condition) => (
    condition.valueFrom ? [condition.valueFrom] : []
  )))];
}

/** 读取单个 property 的默认值。 */
export function getPropertyDefault(property: unknown): JsonValue | undefined {
  if (!isRecord(property) || !('default' in property)) return undefined;
  return property.default as JsonValue;
}

/** 根据 schema 初始化表单 state（仅填充有 default 的项）。 */
export function createInitialFormState(
  schema: JsonSchema,
): Record<FormItemId, JsonValue | undefined> {
  const properties = getSchemaProperties(schema);
  if (!properties) return {};
  return Object.fromEntries(
    Object.entries(properties).flatMap(([itemId, property]) => {
      const value = getPropertyDefault(property);
      return value === undefined ? [] : [[itemId, value]];
    }),
  );
}
