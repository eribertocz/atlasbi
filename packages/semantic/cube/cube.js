// Cube Core configuration of the platform (build steps 3 and 4, docs/04 §6.6). It runs inside the
// Cube container, where this folder is mounted read-only at /cube/conf.
// - Cube reads the lakehouse as its reader, and nothing else (lakehouse-driver.cjs).
// - Who asks, and what they may see, comes from the platform's short query token only
//   (query-security.cjs): no fixed SQL API password, one RLS for REST and SQL.
// Secure mode (NODE_ENV=production, CUBEJS_DEV_MODE=false) and the API secret come from compose.
// `jsonwebtoken` is Cube's own dependency, pinned with the image digest.
const jsonwebtoken = require('jsonwebtoken');

const { LakehouseDuckDBDriver } = require('./lakehouse-driver.cjs');
const { createQuerySecurity } = require('./query-security.cjs');

module.exports = {
  driverFactory: () => new LakehouseDuckDBDriver(),
  ...createQuerySecurity({
    verifyJwt: (token, secret, options) => jsonwebtoken.verify(token, secret, options),
    secret: process.env.CUBEJS_API_SECRET ?? '',
  }),
};
