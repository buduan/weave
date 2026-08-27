import { widgetAcceptsDataType } from '@weave/utils';
import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

export const textareaTemplate: FormItemTemplate = {
  widget: 'textarea',
  label: '多行文本',
  icon: 'i-solar-text-square-bold-duotone',
  compatibleDataTypes: ['string'],
  accepts: (field) => widgetAcceptsDataType('textarea', field.dataType),
  placeholderDefault: '请输入',
  settings: {
    availableIf: true, default: true, placeholder: true, string: true,
  },
  createProperty: (context) => createTemplateProperty('textarea', context, '请输入'),
};
