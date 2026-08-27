import { widgetAcceptsDataType } from '@weave/utils';
import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

export const selectorTemplate: FormItemTemplate = {
  widget: 'selector',
  label: '选择器',
  icon: 'i-solar-list-check-bold-duotone',
  compatibleDataTypes: ['string[]', 'relation'],
  accepts: (field) => widgetAcceptsDataType('selector', field.dataType),
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
