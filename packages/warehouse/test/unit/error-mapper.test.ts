import { LakehouseError, type LakehouseErrorCode } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { redactCredentials, toLakehouseError } from '../../src/adapters/duckdb/error-mapper.ts';
import { ENGINE_MESSAGES } from '../fixtures/engine-messages.ts';

const EXPECTED: Record<keyof typeof ENGINE_MESSAGES, [LakehouseErrorCode, boolean]> = {
  extensionMissing: ['extension_missing', false],
  wrongPasswordInConnectionString: ['catalog_unreachable', false],
  serverUnreachableInConnectionString: ['catalog_unreachable', true],
  serverUnreachableWithSecret: ['catalog_unreachable', true],
  databaseMissing: ['catalog_unreachable', false],
  dataPathMismatch: ['data_path_mismatch', false],
  notProvisioned: ['catalog_unreachable', false],
  writeConflict: ['write_conflict', false],
  syntaxError: ['query_failed', false],
  conversionEchoingLiteral: ['query_failed', false],
  missingTable: ['query_failed', false],
  connectionClosed: ['engine_closed', false],
  formatTooOld: ['catalog_format_mismatch', false],
  formatTooNew: ['catalog_format_mismatch', false],
  sqliteLockedOnCommit: ['catalog_busy', true],
  sqliteLockedOnFlush: ['catalog_busy', true],
  readOnlyInsert: ['read_only_violation', false],
  lockedConfiguration: ['read_only_violation', false],
  outsideAllowedDirectories: ['read_only_violation', false],
};

describe('toLakehouseError', () => {
  for (const [name, message] of Object.entries(ENGINE_MESSAGES)) {
    const [code, retryable] = EXPECTED[name as keyof typeof ENGINE_MESSAGES];

    it(`maps ${name} to ${code}${retryable ? ' (retryable)' : ''}, with no credential in it`, () => {
      const error = toLakehouseError(new Error(message));

      expect(error).toBeInstanceOf(LakehouseError);
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
      expect(`${error.message} ${error.remedy ?? ''}`).not.toMatch(/atlasbi-dev-only|wrong-pass/);
    });
  }

  it('describes each failure in platform words, with a remedy where one exists', () => {
    expect(toLakehouseError(new Error(ENGINE_MESSAGES.extensionMissing))).toMatchObject({
      message: 'The DuckDB extension "ducklake" is not installed.',
      remedy: expect.stringContaining('pnpm bootstrap') as string,
    });
    expect(
      toLakehouseError(new Error(ENGINE_MESSAGES.wrongPasswordInConnectionString)).message,
    ).toBe(
      'Cannot connect to the lakehouse catalog: password authentication failed for user "atlasbi".',
    );
    expect(toLakehouseError(new Error(ENGINE_MESSAGES.formatTooOld)).message).toBe(
      'The lakehouse catalog format is 0.3; this platform reads and writes 1.0.',
    );
    expect(toLakehouseError(new Error(ENGINE_MESSAGES.dataPathMismatch)).message).toBe(
      'The configured data path is not the one this lakehouse recorded (C:/work/s7-pg/files/).',
    );
    expect(toLakehouseError(new Error(ENGINE_MESSAGES.sqliteLockedOnFlush)).remedy).toContain(
      'single writing process',
    );
  });

  it('never advises automatic migration, which the platform never uses', () => {
    const error = toLakehouseError(new Error(ENGINE_MESSAGES.formatTooNew));

    expect(`${error.message} ${error.remedy ?? ''}`).not.toContain('AUTOMATIC_MIGRATION');
  });

  it('keeps a query error readable for whoever wrote the SQL', () => {
    expect(toLakehouseError(new Error(ENGINE_MESSAGES.syntaxError)).message).toBe(
      ENGINE_MESSAGES.syntaxError,
    );
  });

  it('passes a LakehouseError through unchanged', () => {
    const original = new LakehouseError('read_only_violation', 'nope');

    expect(toLakehouseError(original)).toBe(original);
  });
});

describe('redactCredentials', () => {
  it('removes passwords from URLs, keyword strings and secret statements', () => {
    expect(redactCredentials('postgres://atlasbi:s3cret@127.0.0.1:55432/lakehouse')).toBe(
      'postgres://atlasbi:***@127.0.0.1:55432/lakehouse',
    );
    expect(redactCredentials('host=h user=u password=s3cret dbname=d')).toBe(
      'host=h user=u password=*** dbname=d',
    );
    expect(redactCredentials("USER 'u', PASSWORD 'it''s s3cret')")).toBe(
      "USER 'u', PASSWORD '***')",
    );
  });
});
