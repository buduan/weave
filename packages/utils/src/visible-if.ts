import type {
  JsonValue,
  AvailableIfExpression,
  AvailableIfLeafOperator,
} from '@weave/types';

import { canonicalizeJson } from './json';
import { isEmptyJsonValue, isRecord } from './json-guards';

/** 已注册的叶子操作符集合。 */
const leafOperators = new Set<AvailableIfLeafOperator>([
  'equals',
  'not_equals',
  'in',
  'not_in',
  'contains',
  'is_empty',
  'is_not_empty',
]);

/** 递归判断值是否可安全序列化为 JSON。 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

/** 断言对象仅包含指定 key，发现未知 key 时抛出。 */
function assertKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new TypeError(`Unknown availableIf property: ${unknown}`);
}

/**
 * 递归解析不可信的 availableIf 输入。
 * 拒绝未知操作符、空条件组、错误值类型等非法输入。
 */
function parseExpression(input: unknown): AvailableIfExpression {
  if (!isRecord(input) || typeof input.operator !== 'string') {
    throw new TypeError('availableIf must be an object with an operator');
  }

  // 组合操作符：and / or。
  if (input.operator === 'and' || input.operator === 'or') {
    assertKeys(input, ['operator', 'conditions']);
    if (!Array.isArray(input.conditions) || input.conditions.length === 0) {
      throw new TypeError(`availableIf ${input.operator} requires non-empty conditions`);
    }
    return {
      operator: input.operator,
      conditions: input.conditions.map(parseExpression),
    };
  }

  // 取反操作符：not。
  if (input.operator === 'not') {
    assertKeys(input, ['operator', 'condition']);
    return { operator: 'not', condition: parseExpression(input.condition) };
  }

  // 叶子操作符。
  if (!leafOperators.has(input.operator as AvailableIfLeafOperator)) {
    throw new TypeError(`Unknown availableIf operator: ${input.operator}`);
  }
  const operator = input.operator as AvailableIfLeafOperator;
  if (typeof input.fieldId !== 'string' || input.fieldId.length === 0) {
    throw new TypeError('availableIf fieldId must be a non-empty string');
  }

  // is_empty / is_not_empty 仅需 fieldId。
  if (operator === 'is_empty' || operator === 'is_not_empty') {
    assertKeys(input, ['operator', 'fieldId']);
    return { fieldId: input.fieldId, operator };
  }

  // in / not_in 需要 values 数组。
  if (operator === 'in' || operator === 'not_in') {
    assertKeys(input, ['operator', 'fieldId', 'values']);
    if (!Array.isArray(input.values) || !input.values.every(isJsonValue)) {
      throw new TypeError(`availableIf ${operator} requires JSON values`);
    }
    return { fieldId: input.fieldId, operator, values: input.values };
  }

  // 其余叶子操作符需要 value。
  assertKeys(input, ['operator', 'fieldId', 'value']);
  if (!isJsonValue(input.value)) {
    throw new TypeError(`availableIf ${operator} requires a JSON value`);
  }
  return { fieldId: input.fieldId, operator, value: input.value };
}

/** 通过规范 JSON 比较两个值是否相等。 */
function equal(left: JsonValue, right: JsonValue): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

/** 解析并校验不可信的 availableIf 表达式。 */
export function parseAvailableIf(input: unknown): AvailableIfExpression {
  return parseExpression(input);
}

/**
 * 根据 Form 当前值计算 availableIf 表达式结果。
 *
 * 语义约定：
 * - 字段值缺失时除 is_empty 外的叶子判断均返回 false，
 *   避免表单初始化时意外显示依赖项
 * - contains 同时支持字符串包含和数组包含
 * - 比较使用规范 JSON 相等（Object.is 语义 + 对象 key 排序）
 */
export function evaluateAvailableIf(
  expression: AvailableIfExpression,
  values: Readonly<Record<string, JsonValue | undefined>>,
): boolean {
  // 组合表达式。
  if ('conditions' in expression) {
    return expression.operator === 'and'
      ? expression.conditions.every((condition) => evaluateAvailableIf(condition, values))
      : expression.conditions.some((condition) => evaluateAvailableIf(condition, values));
  }
  // 取反表达式。
  if ('condition' in expression) return !evaluateAvailableIf(expression.condition, values);

  // 叶子表达式。
  const current = values[expression.fieldId];
  if (expression.operator === 'is_empty') return isEmptyJsonValue(current);
  if (expression.operator === 'is_not_empty') return !isEmptyJsonValue(current);
  // 字段缺失时（除空值判断外）返回 false。
  if (current === undefined) return false;

  switch (expression.operator) {
    case 'equals':
      return equal(current, expression.value);
    case 'not_equals':
      return !equal(current, expression.value);
    case 'in':
      return expression.values.some((value) => equal(current, value));
    case 'not_in':
      return !expression.values.some((value) => equal(current, value));
    case 'contains':
      // 数组包含任一元素 或 字符串包含子串。
      if (Array.isArray(current)) {
        return current.some((value) => equal(value, expression.value));
      }
      return typeof current === 'string' && typeof expression.value === 'string'
        && current.includes(expression.value);
    default:
      return false;
  }
}
