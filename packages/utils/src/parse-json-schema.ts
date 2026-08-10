import type { JsonSchema, JsonSchemaObject } from '@weave/types';
import { isRecord } from './json-guards';

export type { JsonSchema, JsonSchemaObject, JsonValue } from '@weave/types';

/**
 * Parses a JSON Schema document from a JSON string.
 *
 * The JSON Schema specification permits either an object or a boolean at the
 * document root. Other valid JSON values are rejected.
 *
 * @throws {SyntaxError} When the input is not valid JSON or is not a JSON Schema root.
 */
export function parseJsonSchema(source: string): JsonSchema {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    throw new SyntaxError(`Invalid JSON Schema: ${reason}`);
  }

  if (typeof parsed === 'boolean') {
    return parsed;
  }

  if (isRecord(parsed)) {
    return parsed as JsonSchemaObject;
  }

  throw new SyntaxError('Invalid JSON Schema: the root value must be an object or boolean.');
}
