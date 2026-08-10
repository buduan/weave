import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

const kinds = ['long_text', 'text'] as const;

export const textareaTemplate: FormItemTemplate = {
  widget: 'textarea',
  label: '多行文本',
  icon: 'i-solar-text-square-bold-duotone',
  compatibleDatasetKinds: kinds,
  accepts: (field) => kinds.includes(field.kind as typeof kinds[number]),
  placeholderDefault: '请输入',
  settings: {
    availableIf: true, default: true, placeholder: true, string: true,
  },
  createProperty: (context) => createTemplateProperty('textarea', context, '请输入'),
};
