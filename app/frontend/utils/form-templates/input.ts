import { widgetAcceptsDataType } from '@weave/utils';
import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

export const inputTemplate: FormItemTemplate = {
  widget: 'input',
  label: '单行输入',
  icon: 'i-solar-text-field-focus-bold-duotone',
  compatibleDataTypes: ['string', 'number'],
  accepts: (field) => widgetAcceptsDataType('input', field.dataType),
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
