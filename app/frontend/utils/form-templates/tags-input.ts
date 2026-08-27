import { widgetAcceptsDataType } from '@weave/utils';
import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

export const tagsInputTemplate: FormItemTemplate = {
  widget: 'tags-input',
  label: '标签输入',
  icon: 'i-solar-tag-bold-duotone',
  compatibleDataTypes: ['string[]'],
  accepts: (field) => widgetAcceptsDataType('tags-input', field.dataType),
  placeholderDefault: '输入后按回车',
  settings: {
    array: true,
    availableIf: true,
    default: true,
    placeholder: true,
  },
  createProperty: (context) => createTemplateProperty('tags-input', context, '输入后按回车'),
};
