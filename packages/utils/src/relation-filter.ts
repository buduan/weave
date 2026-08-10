import type {
  FormItemId,
  JsonValue,
  RelationFilterCondition,
  RelationFilterExpression,
} from '@weave/types';

function evaluateCondition(
  condition: RelationFilterCondition,
  targetValues: Readonly<Record<string, JsonValue>>,
  formAnswers: Readonly<Record<FormItemId, JsonValue>>,
): boolean {
  const actual = targetValues[condition.fieldId];
  const expected = condition.valueFrom ? formAnswers[condition.valueFrom] : condition.value;
  if (condition.operator === 'is_empty') {
    return actual === undefined || actual === null || actual === '';
  }
  if (condition.operator === 'is_not_empty') {
    return actual !== undefined && actual !== null && actual !== '';
  }
  if (actual === undefined || expected === undefined) return false;
  if (condition.operator === 'equals') return Object.is(actual, expected);
  if (condition.operator === 'not_equals') return !Object.is(actual, expected);
  if (condition.operator === 'in') return Array.isArray(expected) && expected.includes(actual);
  if (condition.operator === 'contains') {
    return (typeof actual === 'string'
      && typeof expected === 'string'
      && actual.includes(expected))
      || (Array.isArray(actual) && actual.includes(expected));
  }
  return false;
}

/** Evaluate the authoritative Form relation filter against one target Dataset row. */
export function evaluateRelationFilter(
  filter: RelationFilterExpression | undefined,
  targetValues: Readonly<Record<string, JsonValue>>,
  formAnswers: Readonly<Record<FormItemId, JsonValue>>,
): boolean {
  if (!filter) return true;
  const conditions = filter.all ?? filter.any ?? [];
  const results = conditions.map((condition) => (
    evaluateCondition(condition, targetValues, formAnswers)
  ));
  return filter.all ? results.every(Boolean) : results.some(Boolean);
}
