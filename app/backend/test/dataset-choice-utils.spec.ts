import { describe, expect, it } from 'vitest';

import type { DatasetFieldDefinition } from '@weave/types';
import {
  enumerateChoiceLeafPaths,
  getChoiceOptions,
  getDatasetFieldOptions,
  hasChoiceMembershipSchema,
  isCompleteChoicePath,
  normalizeDatasetChoiceConfig,
  normalizeDatasetChoiceOptions,
  resolveDatasetChoiceLabels,
  resolveDatasetChoicePathLabels,
  stripChoiceMembershipSchema,
} from '@weave/utils';

describe('Dataset choice utilities', () => {
  it('normalizes legacy strings and canonical objects without mutating input', () => {
    const source = [
      'legacy',
      { value: 'current', label: 'Current', color: '#334155', i18n: { 'zh-CN': '当前' } },
    ];

    expect(normalizeDatasetChoiceOptions(source)).toEqual([
      { value: 'legacy', label: 'legacy' },
      { value: 'current', label: 'Current', color: '#334155', i18n: { 'zh-CN': '当前' } },
    ]);
    expect(source).toEqual([
      'legacy',
      { value: 'current', label: 'Current', color: '#334155', i18n: { 'zh-CN': '当前' } },
    ]);
    expect(() => normalizeDatasetChoiceOptions(source, { allowLegacyStrings: false }))
      .toThrow('canonical choice object');
  });

  it('distinguishes absent options from explicit empty options', () => {
    expect(normalizeDatasetChoiceConfig('single_select', {})).toMatchObject({
      hasOptions: false,
      optionMode: 'flat',
      options: [],
    });
    expect(normalizeDatasetChoiceConfig('single_select', { options: [] })).toMatchObject({
      hasOptions: true,
      optionMode: 'flat',
      options: [],
    });
  });

  it('rejects duplicate tree values and incompatible option modes', () => {
    expect(() => normalizeDatasetChoiceConfig('multi_select', {
      optionMode: 'cascader',
      options: [{
        value: 'root',
        label: 'Root',
        children: [{ value: 'root', label: 'Duplicate' }],
      }],
    })).toThrow('Duplicate Dataset choice value');
    expect(() => normalizeDatasetChoiceConfig('single_select', {
      optionMode: 'cascader',
      options: [],
    })).toThrow('Cascader requires');
    expect(() => normalizeDatasetChoiceConfig('multi_select', {
      options: [{ value: 'root', label: 'Root', children: [] }],
    })).toThrow('Flat Dataset choices cannot contain children');
    expect(() => normalizeDatasetChoiceOptions([{
      value: 'one',
      label: 'One',
      children: [{
        value: 'two',
        label: 'Two',
        children: [{
          value: 'three',
          label: 'Three',
          children: [{ value: 'four', label: 'Four' }],
        }],
      }],
    }])).toThrow('maximum depth');
    expect(() => normalizeDatasetChoiceOptions(Array.from({ length: 501 }, (_, index) => ({
      value: `value-${index}`,
      label: `Label ${index}`,
    })))).toThrow('maximum nodes');
  });

  it('enumerates only complete variable-depth paths across multiple roots', () => {
    const options = normalizeDatasetChoiceOptions([
      {
        value: 'root-a',
        label: 'Root A',
        children: [
          { value: 'leaf-a', label: 'Leaf A' },
          {
            value: 'branch-a',
            label: 'Branch A',
            children: [{ value: 'deep-a', label: 'Deep A' }],
          },
        ],
      },
      { value: 'root-b', label: 'Root B' },
    ]);

    expect(enumerateChoiceLeafPaths(options)).toEqual([
      ['root-a', 'leaf-a'],
      ['root-a', 'branch-a', 'deep-a'],
      ['root-b'],
    ]);
    expect(isCompleteChoicePath(options, ['root-a', 'leaf-a'])).toBe(true);
    expect(isCompleteChoicePath(options, ['root-b'])).toBe(true);
    expect(isCompleteChoicePath(options, ['root-a'])).toBe(false);
    expect(isCompleteChoicePath(options, ['root-a', 'deep-a'])).toBe(false);
    expect(isCompleteChoicePath(options, ['root-b', 'leaf-a'])).toBe(false);
    expect(resolveDatasetChoiceLabels(options, 'zh-CN')).not.toBe(options);
    expect(resolveDatasetChoicePathLabels(options, ['root-a', 'branch-a', 'deep-a'], 'zh-CN'))
      .toEqual(['Root A', 'Branch A', 'Deep A']);
    expect(resolveDatasetChoicePathLabels(options, ['root-a'], 'zh-CN')).toBeNull();
  });

  it('strips stale choice membership while preserving base constraints', () => {
    const schema = {
      type: 'array',
      minItems: 1,
      enum: [['old-path']],
      items: { type: 'string', minLength: 2, enum: ['old'], oneOf: [{ const: 'old' }] },
    };

    expect(hasChoiceMembershipSchema(schema)).toBe(true);
    expect(stripChoiceMembershipSchema(schema)).toEqual({
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 2 },
    });
    expect(schema.items.enum).toEqual(['old']);
  });

  it('reads scalar and array oneOf/enum as flat choices only', () => {
    expect(getChoiceOptions({ type: 'string', enum: ['one', 'two'] })).toEqual([
      { label: 'one', value: 'one' },
      { label: 'two', value: 'two' },
    ]);
    expect(getChoiceOptions({ type: 'array', items: { enum: ['one', 'two'] } })).toEqual([
      { label: 'one', value: 'one' },
      { label: 'two', value: 'two' },
    ]);
  });

  it('keeps the legacy flat Dataset option reader compatible', () => {
    const field = {
      id: 'field-1',
      kind: 'single_select',
      config: { options: ['legacy', { value: 'current', label: 'Current' }] },
    } as unknown as DatasetFieldDefinition;
    expect(getDatasetFieldOptions(field)).toEqual([
      { value: 'legacy', label: 'legacy' },
      { value: 'current', label: 'Current' },
    ]);
  });
});
