/** A single-quoted SQL string literal; the only way values enter statements built by the adapter. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function listLiteral(values: readonly string[]): string {
  return `[${values.map(quoteLiteral).join(', ')}]`;
}
