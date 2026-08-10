/* eslint-disable import/no-relative-packages -- test-only frontend/backend contract gate */
import {
  DatasetFieldKind,
  DatasetSubjectMode,
  DatasetType,
  FormSubmissionAccess,
  FormWriteMode,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import type {
  DatasetFieldDefinition,
  JsonObject,
  JsonSchema,
  JsonSchemaObject,
} from '@weave/types';

import { FormDefinitionValidatorService } from '../../src/forms/form-definition-validator.service';
import {
  setFormItemAvailableIf,
  setFormItemConstraint,
  setFormItemDefault,
  setFormItemRelationOptions,
  setFormItemRequired,
} from '../../../frontend/utils/form-editor-schema';
import {
  formItemTemplates,
  getFormItemTemplate,
} from '../../../frontend/utils/form-templates/registry';

const datasetId = 'dataset-templates';
const targetDatasetId = 'dataset-target';
const itemIds = [
  'q_11111111-1111-4111-8111-111111111111',
  'q_22222222-2222-4222-8222-222222222222',
  'q_33333333-3333-4333-8333-333333333333',
  'q_44444444-4444-4444-8444-444444444444',
  'q_55555555-5555-4555-8555-555555555555',
  'q_66666666-6666-4666-8666-666666666666',
  'q_77777777-7777-4777-8777-777777777777',
  'q_88888888-8888-4888-8888-888888888888',
] as const;

function field(
  id: string,
  kind: DatasetFieldKind,
  valueSchema: JsonSchema,
  config: JsonObject = {},
  relationTargetDatasetId: string | null = null,
): DatasetFieldDefinition {
  return {
    id,
    datasetId,
    key: id,
    name: id,
    description: null,
    kind,
    valueSchema,
    config,
    required: false,
    isSystemManaged: false,
    systemKey: null,
    relationTargetDatasetId,
    relationCardinality: relationTargetDatasetId ? 'one' : null,
    position: 0,
    revision: 1,
    archivedAt: null,
  };
}

describe('frontend template to backend definition boundary', () => {
  it('accepts every registered template plus completed relation and Settings mutations', () => {
    const fieldsByWidget = {
      input: field('field-input', DatasetFieldKind.text, { type: 'string' }),
      textarea: field('field-textarea', DatasetFieldKind.long_text, { type: 'string' }),
      checkbox: field('field-checkbox', DatasetFieldKind.boolean, { type: 'boolean' }),
      radio: field('field-radio', DatasetFieldKind.single_select, { type: 'string' }, {
        optionMode: 'flat', options: [{ value: 'yes', label: 'Yes' }],
      }),
      selector: field('field-selector', DatasetFieldKind.multi_select, {
        type: 'array', items: { type: 'string' },
      }, { optionMode: 'flat', options: [{ value: 'a', label: 'A' }] }),
      cascader: field('field-cascader', DatasetFieldKind.multi_select, {
        type: 'array', items: { type: 'string' },
      }, {
        optionMode: 'cascader',
        options: [{ value: 'root', label: 'Root', children: [{ value: 'leaf', label: 'Leaf' }] }],
      }),
      'tags-input': field('field-tags', DatasetFieldKind.multi_select, {
        type: 'array', items: { type: 'string' },
      }),
    } satisfies Record<(typeof formItemTemplates)[number]['widget'], DatasetFieldDefinition>;
    const relation = field(
      'field-relation',
      DatasetFieldKind.relation,
      { type: 'string' },
      { labelFieldId: 'target-label' },
      targetDatasetId,
    );
    const properties = Object.fromEntries(formItemTemplates.map((template, index) => [
      itemIds[index],
      template.createProperty({
        datasetField: fieldsByWidget[template.widget],
        locale: 'zh-CN',
        position: index,
      }),
    ])) as Record<string, JsonSchemaObject>;
    const relationItemId = itemIds[7];
    properties[relationItemId] = getFormItemTemplate('selector').createProperty({
      datasetField: relation,
      locale: 'zh-CN',
      position: 7,
    });
    const schema: JsonSchemaObject = {
      type: 'object',
      additionalProperties: false,
      properties,
      'x-form': { version: 1, datasetId, capture: {} },
    };
    const inputItemId = itemIds[0];
    const textareaItemId = itemIds[1];
    setFormItemRequired(schema, inputItemId, true);
    setFormItemConstraint(schema, inputItemId, 'pattern', '^[A-Z]+$');
    setFormItemDefault(schema, inputItemId, 'ABC');
    setFormItemAvailableIf(schema, textareaItemId, {
      fieldId: inputItemId,
      operator: 'equals',
      value: 'ABC',
    });
    setFormItemRelationOptions(schema, relationItemId, {
      labelFieldId: 'target-label',
      filter: {
        all: [{
          fieldId: 'target-filter',
          operator: 'equals',
          valueFrom: inputItemId,
        }],
      },
    });

    const targetFields = [
      {
        ...field('target-label', DatasetFieldKind.text, { type: 'string' }),
        datasetId: targetDatasetId,
      },
      {
        ...field('target-filter', DatasetFieldKind.text, { type: 'string' }),
        datasetId: targetDatasetId,
      },
    ];
    const context = {
      dataset: { id: datasetId, subjectMode: DatasetSubjectMode.none, type: DatasetType.standard },
      fields: [...Object.values(fieldsByWidget), relation, ...targetFields].map((entry) => ({
        ...entry,
        archivedAt: null,
      })),
      targetDatasets: [{ id: targetDatasetId, type: DatasetType.standard }],
      submissionAccess: FormSubmissionAccess.anonymous_allowed,
      writeMode: FormWriteMode.create_row,
    };

    expect(() => new FormDefinitionValidatorService().validate(schema, context)).not.toThrow();
  });
});
