export interface VerifiedAccessToken {
  /** Supabase `auth.users.id`. */
  userId: string;
  email?: string | undefined;
  /**
   * True when the token's `app_metadata.pickler_account` is "wallet": a wallet sign-in account.
   * `app_metadata` is server-only, so this is trustworthy where the email is not.
   */
  walletAccount?: boolean | undefined;
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
