/**
 * The operation a statement performs, from its first keyword only — for `db.operation.name` and for
 * the read port's first line of defense. Low cardinality, and no literal can leak through it.
 */
const OPERATIONS = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'CREATE',
  'DROP',
  'ALTER',
  'CALL',
  'COPY',
  'ATTACH',
  'DETACH',
  'SET',
  'RESET',
  'USE',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'EXPLAIN',
  'PRAGMA',
  'INSTALL',
  'LOAD',
  'CHECKPOINT',
  'VACUUM',
  'ANALYZE',
  'EXPORT',
  'IMPORT',
]);
const READ_KEYWORDS = new Set([
  'WITH',
  'FROM',
  'VALUES',
  'TABLE',
  'SHOW',
  'DESCRIBE',
  'SUMMARIZE',
  'PIVOT',
  'UNPIVOT',
]);

/** Anything outside the known set is left unnamed rather than guessed. */
export function classifyOperation(sql: string): string | undefined {
  const withoutPreamble = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\()+/, '');
  const keyword = /^[A-Za-z]+/.exec(withoutPreamble)?.[0].toUpperCase();
  if (keyword === undefined) {
    return undefined;
  }
  if (READ_KEYWORDS.has(keyword)) {
    return 'SELECT';
  }
  return OPERATIONS.has(keyword) ? keyword : undefined;
}
