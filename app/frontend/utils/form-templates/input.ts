import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

const kinds = ['text', 'number', 'date', 'time', 'datetime', 'email', 'url'] as const;

export const inputTemplate: FormItemTemplate = {
  widget: 'input',
  label: '单行输入',
  icon: 'i-solar-text-field-focus-bold-duotone',
  compatibleDatasetKinds: kinds,
  accepts: (field) => kinds.includes(field.kind as typeof kinds[number]),
  placeholderDefault: '请输入',
  settings: {
    availableIf: true,
    default: true,
    numeric: true,
    placeholder: true,
    string: true,
  },
  createProperty: (context) => createTemplateProperty('input', context, '请输入'),
};
