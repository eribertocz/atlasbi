// Who is asking Cube, and what they may see (build step 4, docs/09 §6.1, docs/04 §6.2 and §6.6).
// The platform signs a short HS256 query token per request; Cube accepts nothing else — over REST
// in the Authorization header, over the SQL API as the password. Its claims become the security
// context, and the groups in it pick the access policies of the model.

/** Kept in step with packages/semantic/src/query-token.ts by a unit test. */
const QUERY_TOKEN = Object.freeze({
  issuer: 'platform-api',
  audience: 'semantic-layer',
  maxLifetimeSeconds: 300,
});

/**
 * A job token (Plan C, decision C3): signed by the platform for `pnpm semantic refresh`, it may run
 * pre-aggregation jobs and nothing else. Kept in step with packages/semantic/src/query-token.ts.
 */
const JOB_SCOPE = 'jobs';

const SQL_API_REFUSAL = 'Invalid SQL API credentials';
const EXPIRED = 'The query token has expired, or it is not short-lived';

function hasShortLife(claims) {
  return (
    typeof claims.iat === 'number' &&
    typeof claims.exp === 'number' &&
    claims.exp > claims.iat &&
    claims.exp - claims.iat <= QUERY_TOKEN.maxLifetimeSeconds
  );
}

// Cube's own work (pre-aggregation refresh, schema compilation) runs without a security context.
// A caller never does: every query token carries at least its issuer and audience.
function isInternal(securityContext) {
  return securityContext === undefined || securityContext === null
    ? true
    : Object.keys(securityContext).length === 0;
}

/**
 * @param {{
 *   verifyJwt: (token: string, secret: string, options: object) => Record<string, unknown>,
 *   secret: string,
 *   now?: () => number,
 * }} dependencies `verifyJwt` is jsonwebtoken's `verify` inside the Cube image — the library Cube
 *   verifies REST tokens with — so both surfaces check signatures the same way.
 */
function createQuerySecurity({ verifyJwt, secret, now = () => Date.now() }) {
  return {
    // REST: Cube's own verification, pinned to one algorithm and to this issuer and audience.
    jwt: {
      algorithms: ['HS256'],
      issuer: [QUERY_TOKEN.issuer],
      audience: QUERY_TOKEN.audience,
    },

    // Cube's API scopes, both ways (Plan C, Phase 0): a job token gets `jobs` alone — it reads no
    // data, no metadata, nothing over SQL — and no other token ever gets `jobs`.
    contextToApiScopes: (securityContext, defaultScopes) =>
      securityContext && securityContext.scope === JOB_SCOPE
        ? [JOB_SCOPE]
        : defaultScopes.filter((scope) => scope !== JOB_SCOPE),

    contextToGroups: ({ securityContext }) =>
      securityContext && Array.isArray(securityContext.groups)
        ? securityContext.groups.filter((group) => typeof group === 'string')
        : [],

    // SQL API: the password is a query token, verified once when the connection opens. There is no
    // fixed password: the same RLS applies as over REST (build step 4, decision E5).
    checkSqlAuth: (_request, _user, password) => {
      let claims;
      try {
        claims = verifyJwt(String(password ?? ''), secret, {
          algorithms: ['HS256'],
          issuer: QUERY_TOKEN.issuer,
          audience: QUERY_TOKEN.audience,
        });
      } catch {
        throw new Error(SQL_API_REFUSAL);
      }
      if (!hasShortLife(claims)) {
        throw new Error(SQL_API_REFUSAL);
      }
      return { password, superuser: false, securityContext: claims };
    },

    // Every query, REST and SQL alike: the token must still be alive. Without this, a SQL API
    // connection would keep its access after the token that opened it expired, and a REST token
    // without an expiry would never expire (Cube does not require one).
    queryRewrite: (query, { securityContext }) => {
      if (isInternal(securityContext)) {
        return query;
      }
      if (!hasShortLife(securityContext) || securityContext.exp * 1000 <= now()) {
        throw new Error(EXPIRED);
      }
      return query;
    },
  };
}

module.exports = { createQuerySecurity, EXPIRED, JOB_SCOPE, QUERY_TOKEN, SQL_API_REFUSAL };
