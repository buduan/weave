import { describe, expect, it } from 'vitest';

import type { JsonSchemaObject } from '@weave/types';
import {
  evaluateFormAnswers,
  evaluateRelationFilter,
  parseFormSchema,
  projectCurrentFormFields,
} from '@weave/utils';
import { formRuntimeCaseIds } from '../../../packages/utils/test-fixtures/form-runtime-cases';

const itemA = 'q_00000000-0000-4000-8000-000000000001';
const itemB = 'q_00000000-0000-4000-8000-000000000002';
const itemC = 'q_00000000-0000-4000-8000-000000000003';

function schema(properties: Record<string, JsonSchemaObject>, required: string[] = []) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
    'x-form': { version: 1, datasetId: 'dataset-1', capture: {} },
  } as JsonSchemaObject;
}

function field(overrides: Record<string, unknown>) {
  return {
    id: 'field-a',
    datasetId: 'dataset-1',
    kind: 'text',
    valueSchema: { type: 'string' },
    config: {},
    isSystemManaged: false,
    archivedAt: null,
    relationCardinality: null,
    ...overrides,
  } as never;
}

describe('Form runtime projection', () => {
  it('uses current flat options and removes stale author and Dataset membership', () => {
    const author = schema({
      [itemA]: {
        type: 'string',
        enum: ['author-old'],
        'x-form': { datasetFieldId: 'field-a', position: 0, ui: { widget: 'selector' } },
      },
    });
    const projected = projectCurrentFormFields(parseFormSchema(author), [field({
      kind: 'single_select',
      valueSchema: { type: 'string', minLength: 2, enum: ['dataset-old'] },
      config: { options: [{ value: 'new', label: 'New', i18n: { 'zh-CN': '新值' } }] },
    })]);
    const property = projected.schema.properties?.[itemA] as JsonSchemaObject;

    expect(property.enum).toEqual(['new']);
    expect(property).not.toHaveProperty('oneOf');
    expect(property.allOf).toEqual([{ type: 'string', minLength: 2 }]);
    expect(projected.choiceOptions[itemA]).toEqual([{
      value: 'new',
      label: '新值',
      i18n: { 'zh-CN': '新值' },
    }]);
    expect(author.properties?.[itemA]).toHaveProperty('enum', ['author-old']);
  });

  it('projects flat multi membership at items and cascader paths at the whole array', () => {
    const flatAuthor = schema({
      [itemA]: {
        type: 'array',
        items: { type: 'string', enum: ['old'] },
        'x-form': { datasetFieldId: 'field-a', position: 0, ui: { widget: 'selector' } },
      },
    });
    const flat = projectCurrentFormFields(parseFormSchema(flatAuthor), [field({
      kind: 'multi_select',
      valueSchema: { type: 'array', items: { type: 'string', enum: ['stale'] } },
      config: { options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] },
    })]);
    const flatProperty = flat.schema.properties?.[itemA] as JsonSchemaObject;
    expect((flatProperty.items as JsonSchemaObject).enum).toEqual(['one', 'two']);
    expect(flatProperty.uniqueItems).toBe(true);

    const cascader = projectCurrentFormFields(parseFormSchema(schema({
      [itemA]: {
        type: 'array',
        items: { type: 'string' },
        'x-form': { datasetFieldId: 'field-a', position: 0, ui: { widget: 'cascader' } },
      },
    })), [field({
      kind: 'multi_select',
      valueSchema: { type: 'array', items: { type: 'string' } },
      config: {
        optionMode: 'cascader',
        options: [
          {
            value: 'root-a',
            label: 'Root A',
            children: [{ value: 'leaf-a', label: 'Leaf A' }],
          },
          { value: 'root-b', label: 'Root B' },
        ],
      },
    })]);
    const cascaderProperty = cascader.schema.properties?.[itemA] as JsonSchemaObject;
    expect(cascaderProperty.enum).toEqual([
      ['root-a', 'leaf-a'],
      ['root-b'],
    ]);
    expect((cascaderProperty.items as JsonSchemaObject)).not.toHaveProperty('enum');
  });

  it('makes explicit empty current options authoritative', () => {
    const author = schema({
      [itemA]: {
        type: 'string',
        enum: ['legacy'],
        'x-form': { datasetFieldId: 'field-a', position: 0 },
      },
    }, [itemA]);
    const projected = projectCurrentFormFields(parseFormSchema(author), [field({
      kind: 'single_select',
      config: { options: [] },
    })]);
    const property = projected.schema.properties?.[itemA] as JsonSchemaObject;

    expect(property).not.toHaveProperty('enum');
    expect(property.allOf).toContain(false);
    expect(projected.choiceOptions[itemA]).toEqual([]);
    expect(projected.configurationInvalidItemIds).toEqual([itemA]);
  });
});

describe('topological Form answer evaluation', () => {
  it(`${formRuntimeCaseIds.defaultRevealsDependent}: applies an upstream valid default before visibility`, () => {
    const author = schema({
      [itemB]: {
        type: 'string',
        'x-form': {
          datasetFieldId: 'field-b',
          position: 1,
          availableIf: { fieldId: itemA, operator: 'equals', value: 'yes' },
        },
      },
      [itemA]: {
        type: 'string',
        default: 'yes',
        'x-form': { datasetFieldId: 'field-a', position: 0 },
      },
    }, [itemB]);
    const inputAnswers = { [itemB]: 'visible' };
    const parsed = parseFormSchema(author);
    const result = evaluateFormAnswers({
      parsed,
      runtimeSchema: author,
      inputAnswers,
      rejectExplicitHidden: true,
    });

    expect(result.answers).toEqual({ [itemA]: 'yes', [itemB]: 'visible' });
    expect(result.visibleItemIds).toEqual([itemA, itemB]);
    expect(result.hiddenSubmittedItemIds).toEqual([]);
    expect(result.effectiveSchema.required).toEqual([itemB]);
    expect(inputAnswers).toEqual({ [itemB]: 'visible' });
  });

  it(`${formRuntimeCaseIds.hiddenChainClears}: clears a hidden chain and reports attacks`, () => {
    const author = schema({
      [itemC]: {
        type: 'string',
        'x-form': {
          datasetFieldId: 'field-c',
          position: 2,
          availableIf: { fieldId: itemB, operator: 'equals', value: 'show-c' },
        },
      },
      [itemB]: {
        type: 'string',
        'x-form': {
          datasetFieldId: 'field-b',
          position: 1,
          availableIf: { fieldId: itemA, operator: 'equals', value: true },
        },
      },
      [itemA]: {
        type: 'boolean',
        'x-form': { datasetFieldId: 'field-a', position: 0 },
      },
    }, [itemB, itemC]);
    const parsed = parseFormSchema(author);
    const result = evaluateFormAnswers({
      parsed,
      runtimeSchema: author,
      inputAnswers: {
        [itemA]: false,
        [itemB]: 'show-c',
        [itemC]: 'hidden',
        q_unknown: 'attack',
      },
      rejectExplicitHidden: true,
    });

    expect(result.answers).toEqual({ [itemA]: false });
    expect(result.hiddenSubmittedItemIds).toEqual([itemB, itemC]);
    expect(result.unknownItemIds).toEqual(['q_unknown']);
    expect(result.effectiveSchema.required).toEqual([]);
    expect(Object.keys(result.effectiveSchema.properties as object)).toEqual([itemA]);
  });

  it('skips a default invalidated by current constraints so it cannot reveal downstream', () => {
    const author = schema({
      [itemA]: {
        type: 'string',
        default: 'deleted',
        'x-form': { datasetFieldId: 'field-a', position: 0, ui: { widget: 'selector' } },
      },
      [itemB]: {
        type: 'string',
        'x-form': {
          datasetFieldId: 'field-b',
          position: 1,
          availableIf: { fieldId: itemA, operator: 'equals', value: 'deleted' },
        },
      },
    });
    const parsed = parseFormSchema(author);
    const projected = projectCurrentFormFields(parsed, [
      field({
        kind: 'single_select',
        config: { options: [{ value: 'current', label: 'Current' }] },
      }),
      field({ id: 'field-b' }),
    ]);
    const result = evaluateFormAnswers({
      parsed,
      runtimeSchema: projected.schema,
      inputAnswers: { [itemB]: 'attack' },
      rejectExplicitHidden: true,
    });

    expect(result.answers).toEqual({});
    expect(result.defaultDiagnostics.map((diagnostic) => diagnostic.itemId)).toEqual([itemA]);
    expect(result.hiddenSubmittedItemIds).toEqual([itemB]);
  });

  it('validates string pattern defaults before they enter working state', () => {
    const author = schema({
      [itemA]: {
        type: 'string',
        pattern: '^[A-Z]+$',
        default: 'lowercase',
        'x-form': { datasetFieldId: 'field-a', position: 0 },
      },
    });
    const result = evaluateFormAnswers({
      parsed: parseFormSchema(author),
      runtimeSchema: author,
      inputAnswers: {},
      rejectExplicitHidden: false,
    });

    expect(result.answers).toEqual({});
    expect(result.defaultDiagnostics).toHaveLength(1);
  });

  it('uses a visible defaulted valueFrom and never exposes a hidden default to a relation filter', () => {
    const visibleAuthor = schema({
      [itemA]: {
        type: 'string',
        default: 'CN',
        'x-form': { datasetFieldId: 'field-a', position: 0 },
      },
    });
    const visible = evaluateFormAnswers({
      parsed: parseFormSchema(visibleAuthor),
      runtimeSchema: visibleAuthor,
      inputAnswers: {},
      rejectExplicitHidden: true,
    });
    const filter = {
      all: [{
        fieldId: 'country',
        operator: 'equals' as const,
        valueFrom: itemA,
      }],
    };
    expect(evaluateRelationFilter(filter, { country: 'CN' }, visible.answers)).toBe(true);

    const hiddenAuthor = schema({
      [itemA]: {
        type: 'string',
        default: 'CN',
        'x-form': {
          datasetFieldId: 'field-a',
          position: 0,
          availableIf: { fieldId: itemB, operator: 'equals', value: true },
        },
      },
      [itemB]: {
        type: 'boolean',
        'x-form': { datasetFieldId: 'field-b', position: 1 },
      },
    });
    const hidden = evaluateFormAnswers({
      parsed: parseFormSchema(hiddenAuthor),
      runtimeSchema: hiddenAuthor,
      inputAnswers: { [itemB]: false },
      rejectExplicitHidden: true,
    });

    expect(hidden.answers).toEqual({ [itemB]: false });
    expect(evaluateRelationFilter(filter, { country: 'CN' }, hidden.answers)).toBe(false);
  });
});
