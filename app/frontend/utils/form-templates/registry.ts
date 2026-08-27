import type { DatasetFieldDefinition, FormWidget } from '@weave/types';
import { cascaderTemplate } from './cascader';
import { checkboxTemplate } from './checkbox';
import { inputTemplate } from './input';
import { radioTemplate } from './radio';
import { selectorTemplate } from './selector';
import { tagsInputTemplate } from './tags-input';
import { textareaTemplate } from './textarea';
import type { FormItemTemplate } from './types';

export const formItemTemplates = [
  inputTemplate,
  textareaTemplate,
  checkboxTemplate,
  radioTemplate,
  selectorTemplate,
  cascaderTemplate,
  tagsInputTemplate,
] as const satisfies readonly FormItemTemplate[];

const templateMap = new Map<FormWidget, FormItemTemplate>(
  formItemTemplates.map((template) => [template.widget, template]),
);

export function getFormItemTemplate(widget: FormWidget): FormItemTemplate {
  const template = templateMap.get(widget);
  if (!template) throw new TypeError(`Unsupported Form widget template: ${widget}`);
  return template;
}

export function inferFormItemTemplate(field: DatasetFieldDefinition): FormItemTemplate | null {
  const preferred: Partial<Record<DatasetFieldDefinition['kind'], FormWidget>> = {
    cascader: 'cascader',
    checkbox: 'checkbox',
    long_text: 'textarea',
    multi_select: 'selector',
    relation: 'selector',
    single_select: 'radio',
    tags: 'tags-input',
  };
  const template = getFormItemTemplate(preferred[field.kind] ?? 'input');
  return template.accepts(field) ? template : null;
}

export type { FormItemTemplate, FormTemplateSettings } from './types';
