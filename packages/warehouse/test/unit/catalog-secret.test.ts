import { LakehouseError } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import {
  createCatalogSecretStatement,
  parsePostgresCatalogUrl,
} from '../../src/adapters/duckdb/catalog-secret.ts';

function rejection(url: string): LakehouseError {
  try {
    parsePostgresCatalogUrl(url);
  } catch (error) {
    return error as LakehouseError;
  }
  throw new Error('expected the URL to be rejected');
}

describe('parsePostgresCatalogUrl', () => {
  it('splits a postgres URL into secret fields, decoding escaped characters', () => {
    expect(
      parsePostgresCatalogUrl('postgres://atlas%40bi:p%40ss%3Aw0rd@127.0.0.1:55432/lakehouse'),
    ).toEqual({
      host: '127.0.0.1',
      port: 55432,
      database: 'lakehouse',
      user: 'atlas@bi',
      password: 'p@ss:w0rd',
    });
  });

  it('defaults the port, accepts postgresql:// and unwraps IPv6 hosts', () => {
    expect(parsePostgresCatalogUrl('postgresql://u:p@[::1]/lakehouse')).toMatchObject({
      host: '::1',
      port: 5432,
    });
  });

  it('refuses parameters it would otherwise drop silently, naming them but never the URL', () => {
    const error = rejection('postgres://u:s3cret@host/lakehouse?sslmode=require');

    expect(error).toBeInstanceOf(LakehouseError);
    expect(error.code).toBe('catalog_unreachable');
    expect(error.message).toContain('sslmode');
    expect(error.message).not.toContain('s3cret');
  });

  it('rejects other schemes and incomplete URLs without echoing them', () => {
    for (const url of ['mysql://u:s3cret@host/db', 'postgres://host/db', 'not a url s3cret']) {
      const error = rejection(url);
      expect(error.code).toBe('catalog_unreachable');
      expect(error.message).not.toContain('s3cret');
    }
  });
});

describe('createCatalogSecretStatement', () => {
  it('builds a temporary secret, escaping quotes inside every value', () => {
    expect(
      createCatalogSecretStatement({
        host: 'db.local',
        port: 5432,
        database: "o'lake",
        user: 'atlasbi',
        password: "it's",
      }),
    ).toBe(
      "CREATE TEMPORARY SECRET lake_catalog (TYPE postgres, HOST 'db.local', PORT 5432, DATABASE 'o''lake', USER 'atlasbi', PASSWORD 'it''s')",
    );
  });
});
