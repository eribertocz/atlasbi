'use strict';

// Cube's DuckDB driver, opening the lakehouse the platform's way (docs/04 §6). Runs inside the Cube
// container, where @cubejs-backend/duckdb-driver and @duckdb/node-api come with the image.

const { DuckDBDriver } = require('@cubejs-backend/duckdb-driver');
const { DuckDBInstance } = require('@duckdb/node-api');

const {
  CLIENT_MESSAGE,
  describeForLog,
  instanceOptions,
  isLakehouseAccessError,
  lakehouseStatements,
} = require('./lakehouse-connection.cjs');

/**
 * Replaces the base driver's init(), which creates its instance with DuckDB's defaults (extensions
 * installed from the Internet) and logs-and-skips a failing initSql — Cube would then answer from
 * cached pre-aggregations while the lakehouse is gone, and /readyz would stay green (build step 3,
 * Phase 0, P3-9). Here every failure surfaces: the details go to the Cube logs, the client gets a
 * message without hosts, addresses, users or keys.
 */
class LakehouseDuckDBDriver extends DuckDBDriver {
  async init() {
    const instance = await DuckDBInstance.create(':memory:', instanceOptions());
    let connection;
    try {
      connection = await instance.connect();
      for (const statement of lakehouseStatements(process.env)) {
        await connection.run(statement);
      }
      return { defaultConnection: connection, instance };
    } catch (error) {
      connection?.closeSync();
      instance.closeSync();
      console.error(`Lakehouse unavailable: ${describeForLog(error)}`);
      // The cause carries hosts, addresses and users: it goes to the log above, never to a client.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(CLIENT_MESSAGE);
    }
  }

  async query(query, values, options) {
    try {
      return await super.query(query, values, options);
    } catch (error) {
      throw sanitized(error);
    }
  }

  async stream(query, values, options) {
    try {
      return await super.stream(query, values, options);
    } catch (error) {
      throw sanitized(error);
    }
  }
}

function sanitized(error) {
  if (!isLakehouseAccessError(error)) {
    return error;
  }
  console.error(`Lakehouse unavailable: ${describeForLog(error)}`);
  return new Error(CLIENT_MESSAGE);
}

module.exports = { LakehouseDuckDBDriver };
