import { describe, expect, it } from 'vitest';

import { driverErrorCode } from '../../src/connection.ts';
import { checkDatabaseConnection, DatabaseUnavailableError } from '../../src/index.ts';

describe('checkDatabaseConnection', () => {
  it('normalizes an unreachable server into a retryable DatabaseUnavailableError', async () => {
    const error: unknown = await checkDatabaseConnection(
      'postgres://nobody:nothing@127.0.0.1:1/none',
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect((error as Error).message).toContain('ECONNREFUSED');
    expect((error as DatabaseUnavailableError).retryable).toBe(true);
  });
});

describe('driverErrorCode', () => {
  it('reads the SQLSTATE or errno code, unwrapping per-address AggregateErrors', () => {
    const authFailure = Object.assign(new Error('password authentication failed'), {
      code: '28P01',
    });

    expect(driverErrorCode(authFailure)).toBe('28P01');
    expect(driverErrorCode(new AggregateError([authFailure]))).toBe('28P01');
    expect(driverErrorCode(new Error('no code'))).toBeUndefined();
  });
});
