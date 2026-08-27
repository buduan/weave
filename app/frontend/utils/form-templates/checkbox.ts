import { widgetAcceptsDataType } from '@weave/utils';
import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

export const checkboxTemplate: FormItemTemplate = {
  widget: 'checkbox',
  label: '复选框',
  icon: 'i-solar-check-square-bold-duotone',
  compatibleDataTypes: ['boolean'],
  accepts: (field) => widgetAcceptsDataType('checkbox', field.dataType),
  settings: { availableIf: true, default: true },
  createProperty: (context) => createTemplateProperty('checkbox', context),
};
