import type { FormItemTemplate } from './types';
import { createTemplateProperty, isFlatChoice } from './base';

export const selectorTemplate: FormItemTemplate = {
  widget: 'selector',
  label: '选择器',
  icon: 'i-solar-list-check-bold-duotone',
  compatibleDatasetKinds: ['single_select', 'multi_select', 'relation'],
  accepts: (field) => field.kind === 'relation'
    || ((field.kind === 'single_select' || field.kind === 'multi_select') && isFlatChoice(field)),
  placeholderDefault: '请选择',
  settings: {
    array: true,
    availableIf: true,
    choices: true,
    default: true,
    placeholder: true,
    relation: true,
  },
  createProperty: (context) => createTemplateProperty('selector', context, '请选择'),
};
