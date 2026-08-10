import { BadRequestException } from '@nestjs/common';
import { DatasetFieldKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { DatasetSchemaService } from '../../src/datasets/dataset-schema.service';

function field(overrides: Record<string, unknown> = {}) {
  return {
    id: 'field-1',
    workspaceId: 1,
    datasetId: 'dataset-1',
    key: 'name',
    name: 'Name',
    description: null,
    kind: DatasetFieldKind.text,
    valueSchema: { type: 'string', maxLength: 4 },
    config: {},
    required: true,
    isSystemManaged: false,
    systemKey: null,
    relationTargetDatasetId: null,
    relationCardinality: null,
    position: 0,
    revision: 1,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Dataset row Schema validation', () => {
  const service = new DatasetSchemaService();

  it('rejects unknown and protected fields', () => {
    expect(() => service.validateRow([field() as never], {
      values: { unknown: 'value' },
      relations: {},
    })).toThrow(BadRequestException);
    expect(() => service.validateRow([
      field({ isSystemManaged: true }) as never,
    ], {
      values: { 'field-1': 'value' },
      relations: {},
    })).toThrow('System-managed field is not writable');
  });

  it('uses the standard JSON Schema constraints on field values', () => {
    expect(() => service.validateRow([field() as never], {
      values: { 'field-1': 'too long' },
      relations: {},
    })).toThrow('Invalid value for Dataset field');
    expect(service.validateRow([field() as never], {
      values: { 'field-1': 'Orz' },
      relations: {},
    }).values).toEqual({ 'field-1': 'Orz' });
  });

  it('uses current flat choices instead of stale valueSchema membership', () => {
    const single = field({
      kind: DatasetFieldKind.single_select,
      valueSchema: { type: 'string', minLength: 2, enum: ['stale'] },
      config: { options: [{ value: 'current', label: 'Current' }] },
    });
    expect(service.validateRow([single as never], {
      values: { 'field-1': 'current' },
      relations: {},
    }).values).toEqual({ 'field-1': 'current' });
    expect(() => service.validateRow([single as never], {
      values: { 'field-1': 'stale' },
      relations: {},
    })).toThrow('Unknown choice');

    const multi = field({
      kind: DatasetFieldKind.multi_select,
      valueSchema: { type: 'array', items: { type: 'string', enum: ['stale'] } },
      config: { options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] },
    });
    expect(service.validateRow([multi as never], {
      values: { 'field-1': ['one', 'two'] },
      relations: {},
    }).values).toEqual({ 'field-1': ['one', 'two'] });
    expect(() => service.validateRow([multi as never], {
      values: { 'field-1': ['one', 'one'] },
      relations: {},
    })).toThrow('Invalid choices');
  });

  it('accepts only one complete current cascader path', () => {
    const cascader = field({
      kind: DatasetFieldKind.multi_select,
      valueSchema: { type: 'array', items: { type: 'string' } },
      config: {
        optionMode: 'cascader',
        options: [
          {
            value: 'root-a',
            label: 'Root A',
            children: [{ value: 'leaf-a', label: 'Leaf A' }],
          },
          {
            value: 'root-b',
            label: 'Root B',
            children: [{ value: 'leaf-b', label: 'Leaf B' }],
          },
        ],
      },
    });
    expect(service.validateRow([cascader as never], {
      values: { 'field-1': ['root-a', 'leaf-a'] },
      relations: {},
    }).values).toEqual({ 'field-1': ['root-a', 'leaf-a'] });
    expect(() => service.validateRow([cascader as never], {
      values: { 'field-1': ['root-a'] },
      relations: {},
    })).toThrow('Incomplete or unknown choice path');
    expect(() => service.validateRow([cascader as never], {
      values: { 'field-1': ['root-a', 'leaf-b'] },
      relations: {},
    })).toThrow('Incomplete or unknown choice path');
  });

  it('does not revalidate untouched removed choices in a partial update', () => {
    const current = field({
      required: false,
      kind: DatasetFieldKind.single_select,
      valueSchema: { type: 'string' },
      config: { options: [{ value: 'current', label: 'Current' }] },
    });
    const other = field({ id: 'field-2', required: false });

    expect(service.validateRow([current, other] as never, {
      values: { 'field-2': 'new' },
      relations: {},
    }, { 'field-1': 'removed' }, true).values).toEqual({
      'field-1': 'removed',
      'field-2': 'new',
    });
    expect(() => service.validateRow([current, other] as never, {
      values: { 'field-1': 'removed' },
      relations: {},
    }, { 'field-1': 'removed' }, true)).toThrow('Unknown choice');
  });

  it('treats explicit empty options as accepting no supplied value', () => {
    const empty = field({
      required: false,
      kind: DatasetFieldKind.single_select,
      valueSchema: { type: 'string', enum: ['legacy'] },
      config: { options: [] },
    });
    expect(service.validateRow([empty as never], { values: {}, relations: {} }).values)
      .toEqual({});
    expect(() => service.validateRow([empty as never], {
      values: { 'field-1': 'legacy' },
      relations: {},
    })).toThrow('no current choices');
  });
});
