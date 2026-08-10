import { describe, expect, it } from 'vitest';

import { evaluateRelationFilter } from '@weave/utils';

describe('evaluateRelationFilter', () => {
  const target = {
    country: 'CN',
    name: 'Beijing',
    tags: ['capital', 'north'],
    empty: '',
  };

  it('shares all/any and literal/valueFrom semantics without mutating inputs', () => {
    const filter = {
      all: [
        { fieldId: 'country', operator: 'equals' as const, valueFrom: 'country-item' },
        { fieldId: 'name', operator: 'contains' as const, value: 'jing' },
        { fieldId: 'tags', operator: 'contains' as const, value: 'capital' },
      ],
    };
    const answers = { 'country-item': 'CN' };
    const targetBefore = structuredClone(target);
    const answersBefore = structuredClone(answers);

    expect(evaluateRelationFilter(filter, target, answers)).toBe(true);
    expect(target).toEqual(targetBefore);
    expect(answers).toEqual(answersBefore);
    expect(evaluateRelationFilter({
      any: [
        { fieldId: 'country', operator: 'equals', value: 'FR' },
        { fieldId: 'empty', operator: 'is_empty' },
      ],
    }, target, answers)).toBe(true);
  });

  it.each([
    ['not_equals', { fieldId: 'country', operator: 'not_equals' as const, value: 'CN' }],
    ['in', { fieldId: 'country', operator: 'in' as const, value: ['FR'] }],
    ['is_not_empty', { fieldId: 'missing', operator: 'is_not_empty' as const }],
    ['missing valueFrom', { fieldId: 'country', operator: 'equals' as const, valueFrom: 'missing' }],
  ])('rejects the %s branch when it does not match', (_caseId, condition) => {
    expect(evaluateRelationFilter({ all: [condition] }, target, {})).toBe(false);
  });
});
