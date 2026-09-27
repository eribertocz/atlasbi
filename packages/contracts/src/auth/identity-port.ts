export const IDENTITY_PORT_VERSION = '1.0';

/**
 * Who someone is, and nothing else: the identity token carries exactly these two claims — never a
 * workspace role, never an entitlement (docs/09 §6.1 and §7, docs/13 §5).
 */
export interface Identity {
  userId: string;
  organizationId: string;
}

export interface NewUser {
  email: string;
  name: string;
  password: string;
}

export const AUTHENTICATION_ERROR_CODES = [
  /** Wrong email or password — deliberately indistinguishable. */
  'invalid_credentials',
  /** The session does not exist anymore, or never did. */
  'session_not_found',
  /** The identity token is malformed, forged, expired or from another deployment. */
  'invalid_token',
  /** An administrative request the platform refuses (bad email, short password, duplicate…). */
  'invalid_request',
] as const;

export type AuthenticationErrorCode = (typeof AUTHENTICATION_ERROR_CODES)[number];

/** The only error the identity port rejects with; it never carries a password or a token. */
export class AuthenticationError extends Error {
  readonly code: AuthenticationErrorCode;

  constructor(code: AuthenticationErrorCode, message: string) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

/**
 * Identity: users, organizations, sessions and the identity token (docs/09 §7). Public sign-up
 * does not exist — creating users is an administrative action.
 */
export interface IdentityPort {
  createUser(user: NewUser): Promise<{ userId: string }>;
  findUserByEmail(email: string): Promise<{ userId: string } | undefined>;
  createOrganization(organization: {
    name: string;
    slug: string;
    ownerUserId: string;
  }): Promise<{ organizationId: string }>;
  findOrganizationBySlug(slug: string): Promise<{ organizationId: string } | undefined>;
  addOrganizationMember(member: { organizationId: string; userId: string }): Promise<void>;
  /** Resolves with an opaque session token — the same credential a browser would hold. */
  signIn(credentials: { email: string; password: string }): Promise<{ sessionToken: string }>;
  signOut(sessionToken: string): Promise<void>;
  /** A short-lived, locally verifiable token with `sub` (user) and `org` (organization) only. */
  issueIdentityToken(sessionToken: string): Promise<string>;
  /** Verifies locally, without asking the database per call once the keys are known. */
  verifyIdentityToken(token: string): Promise<Identity>;
  close(): Promise<void>;
}
