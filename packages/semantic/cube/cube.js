// Cube Core configuration of the platform (build step 3, docs/04 §6). It runs inside the Cube
// container, where this folder is mounted read-only at /cube/conf: Cube reads the lakehouse as its
// reader and nothing else. Everything else comes from the environment compose.yaml sets — secure
// mode (NODE_ENV=production, CUBEJS_DEV_MODE=false), the API secret and the SQL API password.
const { LakehouseDuckDBDriver } = require('./lakehouse-driver.cjs');

module.exports = {
  driverFactory: () => new LakehouseDuckDBDriver(),
};
