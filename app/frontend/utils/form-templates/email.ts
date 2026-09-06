import { widgetAcceptsDataType } from '@weave/utils';
import { createTemplateProperty } from './base';
import type { FormItemTemplate } from './types';

export const emailTemplate: FormItemTemplate = {
  widget: 'email',
  label: '邮箱',
  icon: 'i-solar-letter-bold-duotone',
  compatibleDataTypes: ['string'],
  accepts: (field) => widgetAcceptsDataType('email', field.dataType),
  placeholderDefault: '请输入邮箱',
  settings: {
    availableIf: true,
    default: true,
    fromAuthenticatedEmail: true,
    numeric: false,
    placeholder: true,
    string: true,
  },
  createProperty: (context) => createTemplateProperty('email', context, '请输入邮箱'),
};
