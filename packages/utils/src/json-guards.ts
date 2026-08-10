import type { JsonValue } from '@weave/types';

/** Return true for non-null, non-array object records. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Return true for values treated as empty by Form and Dataset conditions. */
export function isEmptyJsonValue(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);
}
