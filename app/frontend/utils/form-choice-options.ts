import type { DatasetChoiceOption } from '@weave/types';
import { cloneJson } from '@weave/utils';

export interface FlattenedChoiceOption {
  depth: number;
  option: DatasetChoiceOption;
  path: number[];
}

export function createChoiceValue(): string {
  return `option_${crypto.randomUUID()}`;
}

export function flattenChoiceOptions(
  options: readonly DatasetChoiceOption[],
  parentPath: readonly number[] = [],
): FlattenedChoiceOption[] {
  return options.flatMap((option, index) => {
    const path = [...parentPath, index];
    return [
      { depth: parentPath.length, option, path },
      ...flattenChoiceOptions(option.children ?? [], path),
    ];
  });
}

function siblingsAt(
  options: DatasetChoiceOption[],
  parentPath: readonly number[],
): DatasetChoiceOption[] {
  let siblings = options;
  parentPath.forEach((index) => {
    const parent = siblings[index];
    if (!parent) throw new TypeError('找不到选项目录。');
    parent.children ??= [];
    siblings = parent.children;
  });
  return siblings;
}

export function addChoiceOption(
  options: readonly DatasetChoiceOption[],
  parentPath: readonly number[],
  locale: string,
  value = createChoiceValue(),
): DatasetChoiceOption[] {
  if (parentPath.length >= 3) throw new TypeError('级联选项最多支持 3 层。');
  const next = cloneJson(options) as DatasetChoiceOption[];
  siblingsAt(next, parentPath).push({
    value,
    label: '新选项',
    i18n: { [locale]: '新选项' },
  });
  return next;
}

export function updateChoiceOption(
  options: readonly DatasetChoiceOption[],
  path: readonly number[],
  patch: Pick<DatasetChoiceOption, 'color' | 'i18n' | 'label'>,
): DatasetChoiceOption[] {
  const next = cloneJson(options) as DatasetChoiceOption[];
  const index = path.at(-1);
  if (index === undefined) return next;
  const siblings = siblingsAt(next, path.slice(0, -1));
  const current = siblings[index];
  if (!current) return next;
  const updated: DatasetChoiceOption = {
    ...current,
    label: patch.label,
    ...(patch.color ? { color: patch.color } : {}),
    ...(patch.i18n && Object.keys(patch.i18n).length > 0 ? { i18n: patch.i18n } : {}),
  };
  siblings[index] = updated;
  return next;
}

export function removeChoiceOption(
  options: readonly DatasetChoiceOption[],
  path: readonly number[],
): DatasetChoiceOption[] {
  const next = cloneJson(options) as DatasetChoiceOption[];
  const index = path.at(-1);
  if (index === undefined) return next;
  siblingsAt(next, path.slice(0, -1)).splice(index, 1);
  return next;
}

export function moveChoiceOption(
  options: readonly DatasetChoiceOption[],
  path: readonly number[],
  offset: -1 | 1,
): DatasetChoiceOption[] {
  const next = cloneJson(options) as DatasetChoiceOption[];
  const index = path.at(-1);
  if (index === undefined) return next;
  const siblings = siblingsAt(next, path.slice(0, -1));
  const target = index + offset;
  if (target < 0 || target >= siblings.length) return next;
  const [option] = siblings.splice(index, 1);
  if (option) siblings.splice(target, 0, option);
  return next;
}

export function choiceValueImpacts(schema: unknown, value: string): string[] {
  const serialized = JSON.stringify(schema);
  return serialized.includes(JSON.stringify(value))
    ? ['当前 Form 的 default 或条件可能引用该值，删除后请重新验证草稿。']
    : [];
}
