import { LakehouseError } from '@atlasbi/contracts';
import {
  StatementType,
  type DuckDBConnection,
  type DuckDBPreparedStatement,
} from '@duckdb/node-api';

import { classifyOperation } from './statement-keyword.ts';

export type StatementPurpose = 'read' | 'write';

/**
 * Parses and prepares exactly one statement — nothing runs here. The engine already blocks writes
 * on a read-only lakehouse; this allowlist also blocks what a read-only attach still allows
 * (DETACH, CREATE SECRET, SET, temporary tables — Phase 0, S4), because on the read port only a
 * single SELECT is legitimate.
 */
export async function prepareSingleStatement(
  connection: DuckDBConnection,
  sql: string,
  purpose: StatementPurpose,
): Promise<DuckDBPreparedStatement> {
  // The engine's parser fails on blank input with an opaque native error; say it plainly instead.
  if (sql.trim() === '') {
    throw new LakehouseError('query_failed', 'There is no statement to run.');
  }
  // First line of defense: a statement that plainly writes or administers is refused before the
  // engine parses it — preparing it could already fail for unrelated reasons (e.g. a secret type
  // whose extension this instance never loads) and hide what it is. Unknown keywords fall through
  // to the parser, and the prepared statement's type below stays the authoritative check.
  const keyword = classifyOperation(sql);
  if (purpose === 'read' && keyword !== undefined && keyword !== 'SELECT') {
    throw new LakehouseError(
      'read_only_violation',
      'The query port only runs SELECT statements; writes and administration go through the admin port.',
    );
  }
  const extracted = await connection.extractStatements(sql);
  if (extracted.count !== 1) {
    throw purpose === 'read'
      ? new LakehouseError(
          'read_only_violation',
          `The query port runs exactly one SELECT per call; this input has ${extracted.count} statements.`,
        )
      : new LakehouseError(
          'query_failed',
          `execute runs exactly one statement per call; this input has ${extracted.count}.`,
        );
  }
  const prepared = await extracted.prepare(0);
  if (purpose === 'read' && prepared.statementType !== StatementType.SELECT) {
    throw new LakehouseError(
      'read_only_violation',
      'The query port only runs SELECT statements; writes and administration go through the admin port.',
    );
  }
  if (purpose === 'write' && prepared.statementType === StatementType.TRANSACTION) {
    // A transaction held open across calls is what cascades into a locked SQLite catalog (docs/01 §6.6).
    throw new LakehouseError(
      'query_failed',
      'Explicit transactions are not supported: every execute call commits on its own.',
    );
  }
  return prepared;
}
