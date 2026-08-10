import type { FormItemTemplate } from './types';
import { createTemplateProperty } from './base';

export const checkboxTemplate: FormItemTemplate = {
  widget: 'checkbox',
  label: '复选框',
  icon: 'i-solar-check-square-bold-duotone',
  compatibleDatasetKinds: ['boolean'],
  accepts: (field) => field.kind === 'boolean',
  settings: { availableIf: true, default: true },
  createProperty: (context) => createTemplateProperty('checkbox', context),
};
