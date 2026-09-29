/**
 * Whose session the page is holding, and whether it can still be used.
 *
 * A session is issued to one address. The wallet changes under the page — the person switches
 * account, or disconnects — and a token kept without the address it was issued for is then sent as
 * somebody else: the next claim from wallet B would go out under wallet A's name. So the token is
 * stored with its address and chain family, and every use asks `decideSession` first.
 *
 * Pure, and taking the clock as an argument, so every branch is pinned without a browser.
 */

export type SessionNamespace = "eip155" | "solana";

export interface ConnectedWallet {
  address: string;
  namespace: SessionNamespace;
}

export interface WalletSession extends ConnectedWallet {
  token: string;
  /** The account the token is for, so dropping it never signs out a session that is not this one. */
  userId: string;
}

export type SessionDecision =
  { action: "reuse"; token: string } | { action: "sign" } | { action: "none" };

/**
 * How long before its expiry a token stops being handed out. A token that is valid now and lapses
 * while the request is in flight is a 401 the person did nothing to cause.
 */
export const EXPIRY_MARGIN_MS = 60 * 1000;

/**
 * When the token expires, in milliseconds, or null when that cannot be read. Nothing is verified
 * here and nothing needs to be: the API verifies the token, this only decides whether to bother
 * sending it.
 */
export function tokenExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const text = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(text) as { exp?: unknown } | null)?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** EVM addresses are one address in either spelling. Base58 is case-significant. */
function sameWallet(one: ConnectedWallet, other: ConnectedWallet): boolean {
  if (one.namespace !== other.namespace) {
    return false;
  }
  return one.namespace === "eip155"
    ? one.address.toLowerCase() === other.address.toLowerCase()
    : one.address === other.address;
}

export function heldBy(cached: WalletSession | null, connected: ConnectedWallet | null): boolean {
  return cached !== null && connected !== null && sameWallet(cached, connected);
}

export function decideSession(
  cached: WalletSession | null,
  connected: ConnectedWallet | null,
  now: Date,
): SessionDecision {
  if (!connected) {
    return { action: "none" };
  }
  if (!cached || !sameWallet(cached, connected)) {
    return { action: "sign" };
  }
  const expiry = tokenExpiry(cached.token);
  // Written as "not still valid" so that an unreadable expiry signs again rather than being reused.
  if (expiry === null || !(expiry - EXPIRY_MARGIN_MS > now.getTime())) {
    return { action: "sign" };
  }
  return { action: "reuse", token: cached.token };
}

/**
 * The server-only marker of a wallet sign-in account, as core's `WALLET_ACCOUNT_METADATA_KEY` and
 * `WALLET_ACCOUNT_METADATA_VALUE` spell it. `app_metadata` cannot be written by the person.
 */
const ACCOUNT_KEY = "pickler_account";
const WALLET_ACCOUNT = "wallet";

/** As much of Supabase's session as this reads. */
export interface ClientSession {
  user: { id: string; app_metadata?: Record<string, unknown> | null };
}

/**
 * Whether this session is one wallet sign-in made: the session of a wallet account. A studio
 * account that linked a wallet is opened by signing in with it, but that account's session is
 * also what a passkey, an email or Google gave this browser, and it is not the wallet's to end.
 */
export function madeByWalletSignIn(session: ClientSession | null): boolean {
  return session?.user.app_metadata?.[ACCOUNT_KEY] === WALLET_ACCOUNT;
}

/** The two verbs of Supabase's auth client this needs, so a test can stand in for it. */
export interface SessionClient {
  auth: {
    getSession(): Promise<{ data: { session: ClientSession | null } }>;
    signOut(options: { scope: "local" }): Promise<unknown>;
  };
}

/**
 * Signs this browser out of the session wallet sign-in put there, and of no other. The studio
 * shares the client, so the session is left alone when it belongs to another account — someone
 * signed in at `/signin` afterwards — and when it is a studio account's, which a linked wallet
 * opens but did not create. `local` because the other devices of that account did nothing.
 */
export async function dropWalletSession(
  supabase: SessionClient | null,
  cached: { userId: string } | null,
): Promise<void> {
  if (!supabase || !cached) {
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id === cached.userId && madeByWalletSignIn(data.session)) {
    await supabase.auth.signOut({ scope: "local" });
  }
}
