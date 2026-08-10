import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  describe, expect, it,
} from 'vitest';

import {
  canonicalizeJson,
  checksumJson,
  createFormItemId,
  createInitialFormState,
  evaluateAvailableIf,
  filterVisibleAnswers,
  findUnavailableSubmittedItemIds,
  getChoiceOptions,
  getItemExtension,
  getRelationFilterDependencies,
  getRequiredItemIds,
  getRootExtension,
  isItemVisible,
  normalizeFormSchemaPositions,
  parseAvailableIf,
  parseFormSchema,
  resolveLocalizedText,
  validateFormSchemaExtensions,
} from '@weave/utils';

describe('shared Form Schema utilities', () => {
  it('canonicalizes and hashes equivalent JSON objects identically', async () => {
    const first = { nested: { enabled: true }, values: [1, 'two'] };
    const second = { values: [1, 'two'], nested: { enabled: true } };

    expect(canonicalizeJson(first)).toBe(canonicalizeJson(second));
    await expect(checksumJson(first)).resolves.toBe(await checksumJson(second));
  });

  it('creates stable-format opaque item IDs', () => {
    const first = createFormItemId();
    const second = createFormItemId();

    expect(first).toMatch(/^q_[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it('parses and evaluates nested availableIf expressions', () => {
    const expression = parseAvailableIf({
      operator: 'and',
      conditions: [
        { fieldId: 'q_role', operator: 'in', values: ['student', 'teacher'] },
        {
          operator: 'not',
          condition: { fieldId: 'q_disabled', operator: 'equals', value: true },
        },
      ],
    });

    expect(evaluateAvailableIf(expression, { q_disabled: false, q_role: 'student' })).toBe(true);
    expect(evaluateAvailableIf(expression, { q_disabled: true, q_role: 'student' })).toBe(false);
  });

  it('rejects unknown availableIf syntax and handles absent fields conservatively', () => {
    expect(() => parseAvailableIf({ fieldId: 'q_role', operator: 'execute', value: 'x' }))
      .toThrow('Unknown availableIf operator');
    expect(() => parseAvailableIf({
      fieldId: 'q_role',
      operator: 'equals',
      unexpected: true,
      value: 'student',
    })).toThrow('Unknown availableIf property');

    expect(evaluateAvailableIf(
      parseAvailableIf({ fieldId: 'q_missing', operator: 'is_empty' }),
      {},
    )).toBe(true);
    expect(evaluateAvailableIf(
      parseAvailableIf({ fieldId: 'q_missing', operator: 'not_equals', value: 'student' }),
      {},
    )).toBe(false);
  });

  it('keeps constraints, choices and defaults in standard JSON Schema locations', () => {
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        q_choice: {
          type: 'string',
          maxLength: 3,
          oneOf: [{ const: 'yes' }, { const: 'no' }],
          default: 'no',
        },
      },
    };
    const validate = ajv.compile(schema);

    expect(validate({ q_choice: 'yes' })).toBe(true);
    expect(validate({ q_choice: 'maybe' })).toBe(false);
    expect(validate({ q_choice: 'toolong' })).toBe(false);
    expect(validate({})).toBe(true);
  });

  it('validates locale maps, field references, relation filters and x-form keys', () => {
    const controllingId = 'q_00000000-0000-4000-8000-000000000001';
    const dependentId = 'q_00000000-0000-4000-8000-000000000002';
    const schema = {
      type: 'object',
      properties: {
        [controllingId]: {
          type: 'string',
          'x-form': { datasetFieldId: 'dataset-field-1', position: 0 },
        },
        [dependentId]: {
          type: 'string',
          'x-form': {
            datasetFieldId: 'dataset-field-2',
            position: 1,
            i18n: { title: { 'en-US': 'City', 'zh-CN': '城市' } },
            ui: {
              widget: 'selector',
              options: {
                labelFieldId: 'dataset-field-name',
                filter: {
                  all: [{
                    fieldId: 'dataset-field-country',
                    operator: 'equals',
                    valueFrom: controllingId,
                  }],
                },
              },
            },
            availableIf: { fieldId: controllingId, operator: 'not_equals', value: '' },
          },
        },
      },
      'x-form': {
        version: 1,
        datasetId: 'dataset-1',
        capture: {},
      },
    };

    expect(() => validateFormSchemaExtensions(schema)).not.toThrow();

    const unknownExtension = structuredClone(schema);
    Object.assign(unknownExtension.properties[dependentId]['x-form'], { execute: 'script' });
    expect(() => validateFormSchemaExtensions(unknownExtension))
      .toThrow('Unknown Form item x-form property');

    const missingReference = structuredClone(schema);
    missingReference.properties[dependentId]['x-form'].availableIf.fieldId = 'q_missing';
    expect(() => validateFormSchemaExtensions(missingReference))
      .toThrow('Unknown availableIf Form item');
  });

  it('parses required membership and renders by position instead of property key order', () => {
    const firstId = 'q_00000000-0000-4000-8000-000000000001';
    const secondId = 'q_00000000-0000-4000-8000-000000000002';
    const schema = {
      type: 'object',
      properties: {
        [secondId]: {
          type: 'boolean',
          'x-form': { datasetFieldId: 'field-2', position: 1 },
        },
        [firstId]: {
          type: 'string',
          'x-form': {
            datasetFieldId: 'field-1',
            position: 0,
            ui: { widget: 'input' },
          },
        },
      },
      required: [secondId],
      'x-form': { version: 1, datasetId: 'dataset-1', capture: {} },
    };

    const parsed = parseFormSchema(schema);

    expect(parsed.items.map((item) => item.id)).toEqual([firstId, secondId]);
    expect(parsed.items.map((item) => item.widget)).toEqual(['input', 'checkbox']);
    expect(parsed.items.map((item) => item.required)).toEqual([false, true]);
    expect(parsed.items[0]?.property).toBe(schema.properties[firstId]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('normalizes legacy missing positions without mutating the source', () => {
    const firstId = 'q_00000000-0000-4000-8000-000000000001';
    const secondId = 'q_00000000-0000-4000-8000-000000000002';
    const schema = {
      type: 'object',
      properties: {
        [secondId]: {
          type: 'string',
          'x-form': { datasetFieldId: 'field-2', ui: { widget: 'dataset-select' } },
        },
        [firstId]: {
          type: 'string',
          'x-form': { datasetFieldId: 'field-1' },
        },
      },
      'x-form': { version: 1, datasetId: 'dataset-1', capture: {} },
    };

    const parsed = parseFormSchema(schema, { mode: 'legacy' });
    const normalized = normalizeFormSchemaPositions(schema);

    expect(parsed.items.map((item) => [item.id, item.position]))
      .toEqual([[secondId, 0], [firstId, 1]]);
    expect(parsed.items[0]?.widget).toBe('selector');
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(['legacy_position_fallback', 'legacy_widget_alias']);
    expect(normalized.properties?.[secondId]?.['x-form']).toMatchObject({ position: 0 });
    expect(normalized.properties?.[firstId]?.['x-form']).toMatchObject({ position: 1 });
    expect(schema.properties[secondId]['x-form']).not.toHaveProperty('position');
    expect(() => validateFormSchemaExtensions(schema)).toThrow('position is required');
  });

  it('validates root required, positions, extension members and dependency topology', () => {
    const firstId = 'q_00000000-0000-4000-8000-000000000001';
    const secondId = 'q_00000000-0000-4000-8000-000000000002';
    const thirdId = 'q_00000000-0000-4000-8000-000000000003';
    const schema = {
      type: 'object',
      properties: {
        [thirdId]: {
          type: 'string',
          'x-form': {
            datasetFieldId: 'field-3',
            position: 2,
            ui: {
              options: {
                filter: {
                  all: [{ fieldId: 'target', operator: 'equals', valueFrom: secondId }],
                },
              },
            },
          },
        },
        [secondId]: {
          type: 'string',
          'x-form': {
            datasetFieldId: 'field-2',
            position: 1,
            availableIf: { fieldId: firstId, operator: 'equals', value: 'yes' },
          },
        },
        [firstId]: {
          type: 'string',
          'x-form': { datasetFieldId: 'field-1', position: 0 },
        },
      },
      required: [thirdId],
      'x-form': { version: 1, datasetId: 'dataset-1', capture: {} },
    };

    expect(parseFormSchema(schema).topologicalItems.map((item) => item.id))
      .toEqual([firstId, secondId, thirdId]);

    const duplicateRequired = structuredClone(schema);
    duplicateRequired.required = [thirdId, thirdId];
    expect(() => parseFormSchema(duplicateRequired)).toThrow('Duplicate Form Schema required item');

    const unknownRequired = structuredClone(schema);
    unknownRequired.required = ['q_00000000-0000-4000-8000-000000000099'];
    expect(() => parseFormSchema(unknownRequired)).toThrow('Unknown Form Schema required item');

    const nonContiguous = structuredClone(schema);
    nonContiguous.properties[thirdId]['x-form'].position = 3;
    expect(() => parseFormSchema(nonContiguous)).toThrow('unique and contiguous');

    const forbiddenRequired = structuredClone(schema);
    Object.assign(forbiddenRequired.properties[firstId]['x-form'], { required: true });
    expect(() => parseFormSchema(forbiddenRequired)).toThrow('Unknown Form item x-form property');

    const cyclic = structuredClone(schema);
    cyclic.properties[firstId]['x-form'].availableIf = {
      fieldId: thirdId,
      operator: 'is_not_empty',
    };
    expect(() => parseFormSchema(cyclic)).toThrow('Cyclic Form item dependencies');

    const selfReference = structuredClone(schema);
    selfReference.properties[firstId]['x-form'].availableIf = {
      fieldId: firstId,
      operator: 'is_not_empty',
    };
    expect(() => parseFormSchema(selfReference)).toThrow('cannot depend on itself');
  });

  it('soft-reads extensions, choices, locale text, and defaults without throwing', () => {
    const itemId = 'q_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const schema = {
      type: 'object',
      properties: {
        [itemId]: {
          type: 'string',
          default: 'engineering',
          oneOf: [
            {
              const: 'engineering',
              'x-form': { i18n: { title: { 'zh-CN': '研发', en: 'Eng' } } },
            },
            { const: 'design' },
          ],
          'x-form': {
            datasetFieldId: 'fld_dept',
            i18n: { title: { 'zh-CN': '部门', en: 'Dept' } },
            ui: { widget: 'radio' },
            availableIf: { fieldId: itemId, operator: 'is_not_empty' },
          },
        },
      },
      required: [itemId],
      'x-form': {
        version: 1,
        datasetId: 'ds_1',
        capture: {},
      },
    };

    expect(resolveLocalizedText({ en: 'Hello', 'zh-CN': '你好' }, 'en')).toBe('Hello');
    expect(resolveLocalizedText({ en: 'Hello' }, 'zh-CN')).toBe('Hello');
    expect(resolveLocalizedText(
      { en: 'Hello', fr: '', 'zh-CN': '你好' },
      'fr',
      'en',
    )).toBe('Hello');
    expect(getRootExtension(schema)?.datasetId).toBe('ds_1');
    expect(getItemExtension(schema.properties[itemId])?.ui?.widget).toBe('radio');
    expect(getRequiredItemIds(schema).has(itemId)).toBe(true);
    expect(getChoiceOptions(schema.properties[itemId], 'zh-CN')).toEqual([
      { label: '研发', value: 'engineering' },
      { label: 'design', value: 'design' },
    ]);
    expect(getChoiceOptions(schema.properties[itemId], 'fr', 'en')).toEqual([
      { label: 'Eng', value: 'engineering' },
      { label: 'design', value: 'design' },
    ]);
    expect(createInitialFormState(schema)).toEqual({ [itemId]: 'engineering' });
    expect(isItemVisible(getItemExtension(schema.properties[itemId]), { [itemId]: 'x' })).toBe(true);
    expect(isItemVisible(getItemExtension(schema.properties[itemId]), {})).toBe(false);
    expect(getRootExtension(true)).toBeNull();
  });

  it('filters unavailable answers and reports injected hidden items', () => {
    const controllingId = 'q_00000000-0000-4000-8000-000000000001';
    const dependentId = 'q_00000000-0000-4000-8000-000000000002';
    const schema = {
      type: 'object',
      properties: {
        [controllingId]: {
          type: 'boolean',
          'x-form': { datasetFieldId: 'enabled' },
        },
        [dependentId]: {
          type: 'string',
          'x-form': {
            datasetFieldId: 'detail',
            availableIf: {
              fieldId: controllingId,
              operator: 'equals',
              value: true,
            },
          },
        },
      },
    };

    expect(filterVisibleAnswers(schema, {
      [controllingId]: false,
      [dependentId]: 'hidden value',
      q_unknown: 'ignored',
    })).toEqual({ [controllingId]: false });
    expect(findUnavailableSubmittedItemIds(schema, {
      [controllingId]: false,
      [dependentId]: 'hidden value',
    })).toEqual([dependentId]);
    expect(filterVisibleAnswers(schema, {
      [controllingId]: true,
      [dependentId]: 'visible value',
    })).toEqual({
      [controllingId]: true,
      [dependentId]: 'visible value',
    });
  });

  it('extracts unique relation valueFrom dependencies in declaration order', () => {
    expect(getRelationFilterDependencies({
      all: [
        { fieldId: 'country', operator: 'equals', valueFrom: 'q_country' },
        { fieldId: 'region', operator: 'equals', valueFrom: 'q_region' },
        { fieldId: 'country_copy', operator: 'equals', valueFrom: 'q_country' },
        { fieldId: 'active', operator: 'equals', value: true },
      ],
    })).toEqual(['q_country', 'q_region']);
    expect(getRelationFilterDependencies(undefined)).toEqual([]);
  });
});
