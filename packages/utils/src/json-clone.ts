/** Clone JSON data without requiring structured-clone support for reactive proxies. */
export function cloneJson<T>(value: T): T {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? value : JSON.parse(serialized) as T;
}
