import type { DatasetChoiceOption } from '@weave/types';

export type FormItemValue = string | number;

export interface FormItemOption {
  label?: string;
  value?: FormItemValue;
  description?: string;
  disabled?: boolean;
  children?: FormItemOption[];
  [key: string]: unknown;
}

export type FormItemOptionInput = FormItemOption | FormItemValue;

export interface NormalizeFormItemOptions {
  labelKey?: string;
  recursive?: boolean;
  valueKey?: string;
}

export function isFormItemOption(item: FormItemOptionInput): item is FormItemOption {
  return typeof item === 'object' && item !== null;
}

export function normalizeFormItemOptions(
  items: readonly FormItemOptionInput[],
  options: NormalizeFormItemOptions = {},
): FormItemOptionInput[] {
  const valueKey = options.valueKey ?? 'value';
  const labelKey = options.labelKey ?? 'label';

  const normalize = (item: FormItemOptionInput): FormItemOptionInput => {
    if (!isFormItemOption(item)) return item;

    const normalized: FormItemOption = { ...item };
    const value = item[valueKey];
    const label = item[labelKey];
    if (typeof value === 'string' || typeof value === 'number') normalized.value = value;
    if (typeof label === 'string') normalized.label = label;
    if (options.recursive && Array.isArray(item.children)) {
      normalized.children = item.children.map(normalize).filter(isFormItemOption);
    }
    return normalized;
  };

  return items.map(normalize);
}

export function toFormItemOptions(
  options: readonly DatasetChoiceOption[],
): FormItemOption[] {
  return options.map((option) => ({
    label: option.label,
    value: option.value,
    ...(option.color && { color: option.color }),
    ...(option.children && { children: toFormItemOptions(option.children) }),
  }));
}
