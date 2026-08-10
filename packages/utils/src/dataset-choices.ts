import type {
  DatasetChoiceOption,
  DatasetChoiceOptionMode,
  DatasetFieldKind,
  JsonSchema,
  JsonSchemaObject,
} from '@weave/types';
import { cloneJson } from './json-clone';
import { isRecord } from './json-guards';

export const DATASET_CHOICE_MAX_DEPTH = 3;
export const DATASET_CHOICE_MAX_NODES = 500;
export const DATASET_CHOICE_MAX_VALUE_LENGTH = 128;
export const DATASET_CHOICE_MAX_LABEL_LENGTH = 256;

export interface NormalizeDatasetChoiceOptions {
  allowLegacyStrings?: boolean;
}

export interface NormalizedDatasetChoiceConfig {
  hasOptions: boolean;
  optionMode: DatasetChoiceOptionMode;
  options: DatasetChoiceOption[];
}

function assertBoundedText(value: unknown, name: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a non-empty string of at most ${maximum} characters`);
  }
}

function normalizeI18n(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new TypeError(`${path} must be a non-empty locale map`);
  }
  return Object.fromEntries(Object.entries(value).map(([locale, label]) => {
    assertBoundedText(locale, `${path} locale`, 64);
    assertBoundedText(label, `${path}.${locale}`, DATASET_CHOICE_MAX_LABEL_LENGTH);
    return [locale, label];
  }));
}

/** Normalize legacy and canonical options into a validated, detached canonical tree. */
export function normalizeDatasetChoiceOptions(
  value: unknown,
  options: NormalizeDatasetChoiceOptions = {},
): DatasetChoiceOption[] {
  if (!Array.isArray(value)) throw new TypeError('Dataset choice options must be an array');
  const seenValues = new Set<string>();
  let nodeCount = 0;

  const visit = (rawOption: unknown, depth: number, path: string): DatasetChoiceOption => {
    if (depth > DATASET_CHOICE_MAX_DEPTH) {
      throw new TypeError(`Dataset choice tree exceeds maximum depth ${DATASET_CHOICE_MAX_DEPTH}`);
    }
    nodeCount += 1;
    if (nodeCount > DATASET_CHOICE_MAX_NODES) {
      throw new TypeError(`Dataset choice tree exceeds maximum nodes ${DATASET_CHOICE_MAX_NODES}`);
    }

    let option: Record<string, unknown>;
    if (typeof rawOption === 'string') {
      if (options.allowLegacyStrings === false) {
        throw new TypeError(`${path} must use the canonical choice object shape`);
      }
      option = { value: rawOption, label: rawOption };
    } else if (isRecord(rawOption)) {
      option = rawOption;
    } else {
      throw new TypeError(`${path} must be a choice object or legacy string`);
    }

    const unknownKey = Object.keys(option)
      .find((key) => !['children', 'color', 'i18n', 'label', 'value'].includes(key));
    if (unknownKey) throw new TypeError(`Unknown Dataset choice property: ${unknownKey}`);
    assertBoundedText(option.value, `${path}.value`, DATASET_CHOICE_MAX_VALUE_LENGTH);
    assertBoundedText(option.label, `${path}.label`, DATASET_CHOICE_MAX_LABEL_LENGTH);
    if (seenValues.has(option.value)) {
      throw new TypeError(`Duplicate Dataset choice value: ${option.value}`);
    }
    seenValues.add(option.value);
    if (option.color !== undefined) assertBoundedText(option.color, `${path}.color`, 64);
    const i18n = normalizeI18n(option.i18n, `${path}.i18n`);
    let children: DatasetChoiceOption[] | undefined;
    if (option.children !== undefined) {
      if (!Array.isArray(option.children)) throw new TypeError(`${path}.children must be an array`);
      children = option.children.map((child, index) => (
        visit(child, depth + 1, `${path}.children[${index}]`)
      ));
    }
    return {
      value: option.value,
      label: option.label,
      ...(i18n && { i18n }),
      ...(typeof option.color === 'string' && { color: option.color }),
      ...(children && { children }),
    };
  };

  return value.map((option, index) => visit(option, 1, `options[${index}]`));
}

/** Parse a field's choice configuration while preserving absent versus explicitly empty options. */
export function normalizeDatasetChoiceConfig(
  kind: DatasetFieldKind,
  config: unknown,
  options: NormalizeDatasetChoiceOptions = {},
): NormalizedDatasetChoiceConfig {
  if (!isRecord(config)) throw new TypeError('Dataset field config must be an object');
  const hasOptions = Object.hasOwn(config, 'options');
  const rawMode = config.optionMode ?? 'flat';
  if (rawMode !== 'flat' && rawMode !== 'cascader') {
    throw new TypeError(`Unknown Dataset choice optionMode: ${String(rawMode)}`);
  }
  const choiceKind = kind === 'single_select' || kind === 'multi_select';
  if (!choiceKind && (hasOptions || Object.hasOwn(config, 'optionMode'))) {
    throw new TypeError(`Dataset field kind ${kind} does not support choice options`);
  }
  if (rawMode === 'cascader' && kind !== 'multi_select') {
    throw new TypeError('Cascader requires a multi_select Dataset field');
  }
  const normalizedOptions = hasOptions
    ? normalizeDatasetChoiceOptions(config.options, options)
    : [];
  if (rawMode === 'flat') {
    const nested = normalizedOptions.find((option) => option.children !== undefined);
    if (nested) throw new TypeError('Flat Dataset choices cannot contain children');
  }
  return { hasOptions, optionMode: rawMode, options: normalizedOptions };
}

/** Enumerate only complete root-to-leaf paths, in configured display order. */
export function enumerateChoiceLeafPaths(
  options: readonly DatasetChoiceOption[],
): string[][] {
  const paths: string[][] = [];
  const visit = (nodes: readonly DatasetChoiceOption[], prefix: readonly string[]): void => {
    nodes.forEach((node) => {
      const path = [...prefix, node.value];
      if (node.children && node.children.length > 0) visit(node.children, path);
      else paths.push(path);
    });
  };
  visit(options, []);
  return paths;
}

/** Return true only for one configured, complete root-to-leaf path. */
export function isCompleteChoicePath(
  options: readonly DatasetChoiceOption[],
  path: unknown,
): path is string[] {
  if (!Array.isArray(path) || path.length === 0 || !path.every((part) => typeof part === 'string')) {
    return false;
  }
  return enumerateChoiceLeafPaths(options).some((candidate) => (
    candidate.length === path.length
    && candidate.every((part, index) => part === path[index])
  ));
}

/** Resolve localized labels without mutating the persisted option tree. */
export function resolveDatasetChoiceLabels(
  options: readonly DatasetChoiceOption[],
  locale: string,
): DatasetChoiceOption[] {
  return options.map((option) => ({
    ...option,
    label: option.i18n?.[locale] || option.label,
    ...(option.children && {
      children: resolveDatasetChoiceLabels(option.children, locale),
    }),
  }));
}

/** Resolve one complete configured path to display labels, or null for an invalid/prefix path. */
export function resolveDatasetChoicePathLabels(
  options: readonly DatasetChoiceOption[],
  path: unknown,
  locale: string,
): string[] | null {
  if (!isCompleteChoicePath(options, path)) return null;
  const labels: string[] = [];
  let nodes = options;
  path.forEach((value) => {
    const option = nodes.find((candidate) => candidate.value === value)!;
    labels.push(option.i18n?.[locale] || option.label);
    nodes = option.children ?? [];
  });
  return labels;
}

/** Detect legacy membership keywords at the choice field's supported Schema locations. */
export function hasChoiceMembershipSchema(valueSchema: JsonSchema): boolean {
  if (typeof valueSchema === 'boolean') return false;
  if (Array.isArray(valueSchema.enum) || Array.isArray(valueSchema.oneOf)) return true;
  const items = valueSchema.items;
  return isRecord(items) && (Array.isArray(items.enum) || Array.isArray(items.oneOf));
}

/** Remove only choice membership, retaining type/format/length/count and other base constraints. */
export function stripChoiceMembershipSchema(valueSchema: JsonSchema): JsonSchema {
  if (typeof valueSchema === 'boolean') return valueSchema;
  const normalized = cloneJson(valueSchema);
  delete normalized.enum;
  delete normalized.oneOf;
  if (isRecord(normalized.items)) {
    delete normalized.items.enum;
    delete normalized.items.oneOf;
  }
  return normalized as JsonSchemaObject;
}
