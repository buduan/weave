import { widgetAcceptsDataType } from '@weave/utils';
import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

export const radioTemplate: FormItemTemplate = {
  widget: 'radio',
  label: '单选项',
  icon: 'i-solar-record-circle-bold-duotone',
  compatibleDataTypes: ['string[]'],
  accepts: (field) => widgetAcceptsDataType('radio', field.dataType),
  settings: { availableIf: true, choices: true, default: true },
  createProperty: (context) => createTemplateProperty('radio', context),
};
