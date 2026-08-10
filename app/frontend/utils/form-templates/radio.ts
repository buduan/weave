import type { FormItemTemplate } from './types';
import { createTemplateProperty, isFlatChoice } from './base';

export const radioTemplate: FormItemTemplate = {
  widget: 'radio',
  label: '单选项',
  icon: 'i-solar-record-circle-bold-duotone',
  compatibleDatasetKinds: ['single_select'],
  accepts: (field) => field.kind === 'single_select' && isFlatChoice(field),
  settings: { availableIf: true, choices: true, default: true },
  createProperty: (context) => createTemplateProperty('radio', context),
};
