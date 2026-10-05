/**
 * Contract version of {@link IdentityHttpHandler} (docs/21 §2), `MAJOR.MINOR`: a minor version only
 * adds (an optional field in an answer); a new operation, or anything a client could trip over, is
 * a major one.
 */
export const IDENTITY_HTTP_VERSION = '1.0';

/**
 * The identity layer's HTTP surface, for the browser (build step 5, decision G4): exactly these
 * operations and nothing else. The platform names them; which route of the identity provider
 * answers each one is the adapter's business, so no provider path reaches the API gateway.
 */
export const IDENTITY_HTTP_OPERATIONS = ['sign-in', 'sign-out', 'token'] as const;

export type IdentityHttpOperation = (typeof IDENTITY_HTTP_OPERATIONS)[number];

/**
 * Web-standard requests in, web-standard responses out. Answers, per operation:
 *
 * - `sign-in` (POST, JSON `{ email, password }`): 200 `{}` with the session cookie; 401
 *   `invalid_credentials` for any wrong email or password alike; 400 `invalid_request`.
 * - `sign-out` (POST): 200 `{}`, clearing the cookie.
 * - `token` (GET, with the session cookie): 200 `{ token }`, a fresh identity token; 401
 *   `session_not_found`.
 * - 403 `forbidden_origin` when the request's Origin is not the platform's.
 *
 * Errors are `{ code, message }`. A body never carries the session token nor the provider's user
 * record: the cookie is the only session credential the browser gets.
 */
export interface IdentityHttpHandler {
  handle(operation: IdentityHttpOperation, request: Request): Promise<Response>;
  close(): Promise<void>;
}
