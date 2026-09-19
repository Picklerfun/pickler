export interface VerifiedAccessToken {
  /** Supabase `auth.users.id`. */
  userId: string;
  email?: string | undefined;
}

export class InvalidAccessTokenError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Invalid access token", options);
    this.name = "InvalidAccessTokenError";
  }
}

export interface AccessTokenVerifier {
  /** Rejects with InvalidAccessTokenError for any invalid, expired or mis-issued token. */
  verify(token: string): Promise<VerifiedAccessToken>;
}
