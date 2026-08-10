/** Resolve read-compatible widget aliases to the canonical renderer key. */
export function resolveWidgetName(widget: string | undefined): string | undefined {
  if (!widget) return undefined;
  if (widget === 'text') return 'input';
  if (widget === 'dataset-select') return 'selector';
  return widget;
}

/** Resolve the HTML input type supported by the input renderer. */
export function resolveInputType(property: unknown): string {
  if (property === null || typeof property !== 'object' || Array.isArray(property)) {
    return 'text';
  }
  const schema = property as Record<string, unknown>;
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.format === 'email') return 'email';
  if (schema.format === 'uri' || schema.format === 'url') return 'url';
  if (schema.format === 'date') return 'date';
  if (schema.format === 'time') return 'time';
  if (schema.format === 'date-time') return 'datetime-local';
  return 'text';
}
