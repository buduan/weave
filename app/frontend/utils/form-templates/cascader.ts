import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

export const cascaderTemplate: FormItemTemplate = {
  widget: 'cascader',
  label: '级联选择',
  icon: 'i-solar-hierarchy-2-bold-duotone',
  compatibleDatasetKinds: ['multi_select'],
  accepts: (field) => field.kind === 'multi_select' && field.config.optionMode === 'cascader',
  placeholderDefault: '请选择',
  settings: {
    array: true,
    availableIf: true,
    choices: true,
    default: true,
    placeholder: true,
  },
  createProperty: (context) => createTemplateProperty('cascader', context, '请选择'),
};
