import { widgetAcceptsDataType } from '@weave/utils';
import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

export const cascaderTemplate: FormItemTemplate = {
  widget: 'cascader',
  label: '级联选择',
  icon: 'i-solar-hierarchy-2-bold-duotone',
  compatibleDataTypes: ['string[]'],
  accepts: (field) => widgetAcceptsDataType('cascader', field.dataType),
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
