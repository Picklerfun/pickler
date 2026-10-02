import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  WALLET_ACCOUNT_METADATA_KEY,
  WALLET_ACCOUNT_METADATA_VALUE,
  WalletAccountConflictError,
  type AccountProvisioner,
  type Namespace,
  type NormalizedAddress,
} from "@pickler/core";
import type { SupabaseAdmin } from "./supabase-admin-client.js";

/**
 * Supabase Auth wants an email or a phone and a wallet has neither, so the user is created with a
 * synthetic, non-deliverable address derived from the wallet.
 *
 * It is an internal key and never a contact: it is shown on no screen and never sent to. The real
 * email a person gives later is a field on their profile, not a change to this identity — because
 * changing it would mean rewriting the row every other table points at, and because linking a
 * second wallet would otherwise look like changing your email address.
 *
 * The domain must therefore never be made to accept mail.
 *
 * The local part is a digest rather than the address itself, and that is the point. The auth email
 * travels in every access token's `email` claim, so it reaches the browser on every request and
 * lands in any log or screen that reads a user's email. Embedding the address there would make all
 * of those a disclosure of which wallet an account belongs to; a digest makes them an opaque token
 * that only `identity.wallet_links` can resolve, which is what "internal key" was supposed to mean.
 *
 * It also removes a whole shape of bug rather than one instance of it. Base58 is case-significant
 * while email local parts are not, so spelling an address into one risked mapping two distinct
 * Solana wallets onto a single account. A hex digest has no case to lose, so a namespace added
 * later whose addresses are case-significant cannot reintroduce it.
 *
 * The namespace is both hashed in and kept as a visible prefix: hashed so one address on two chain
 * families is two accounts, visible so an operator can still tell the families apart.
 */
export function syntheticEmail(
  namespace: Namespace,
  address: NormalizedAddress,
  domain: string,
): string {
  const digest = bytesToHex(sha256(new TextEncoder().encode(`${namespace}:${address}`)));
  return `${namespace}-${digest}@${domain}`;
}

/** What `findAuthUser` answers: an auth user, as far as telling who made it goes. */
export interface AuthUserFacts {
  id: string;
  email: string | null;
  /**
   * `auth.users.encrypted_password` is set; `admin.createUser` without a password leaves it empty.
   * Null when unknown: the admin API, the only read where `auth.users` is not reachable (a local
   * run on a plain PostgreSQL), does not say — and unknown is never taken for "no".
   */
  hasPassword: boolean | null;
  /** `auth.identities.provider` for every identity the user has. */
  providers: readonly string[];
  /** `auth.users.raw_app_meta_data`, which only the secret key can write. */
  appMetadata: Record<string, unknown>;
}

/**
 * Whose account sits at this address's synthetic email.
 *
 * - `other`: the email is not this address's synthetic one — an email account that linked the
 *   wallet, which signs in to itself and stays a studio account.
 * - `wallet`: it carries the server-only wallet-account marker.
 * - `legacy`: wallet sign-in made it before the marker existed — no password, and no identity but
 *   the `email` one `admin.createUser` gives it.
 * - `conflict`: anything else — above all a password. The synthetic email is sha256 of a public
 *   address, so with password sign-up open anyone can register it ahead of the wallet's holder;
 *   accepting that account would hand the wallet's sign-in to whoever knows its password.
 */
export function walletAccountVerdict(
  user: AuthUserFacts,
  ownEmail: string,
): "other" | "wallet" | "legacy" | "conflict" {
  if (user.email?.toLowerCase() !== ownEmail.toLowerCase()) {
    return "other";
  }
  if (user.appMetadata[WALLET_ACCOUNT_METADATA_KEY] === WALLET_ACCOUNT_METADATA_VALUE) {
    return "wallet";
  }
  if (user.hasPassword === false && user.providers.every((provider) => provider === "email")) {
    return "legacy";
  }
  return "conflict";
}

/** Refuses a conflicting account, logging the address's digest and never the email. */
function refuse(namespace: Namespace, address: NormalizedAddress, userId: string): never {
  const digest = syntheticEmail(namespace, address, "x").split("@")[0];
  console.warn(
    `[wallet-auth] refused wallet sign-in for ${digest}: auth user ${userId} was not made by wallet sign-in`,
  );
  throw new WalletAccountConflictError();
}

export interface WalletAccountsConfig {
  admin: SupabaseAdmin;
  /** e.g. "wallet.pickler.fun". Never deliverable. */
  emailDomain: string;
  /**
   * Reads an auth user by their synthetic address or by id, with the facts that tell an account
   * wallet sign-in made from one somebody registered by hand; null when there is none. Injected
   * because the Supabase admin API has no lookup by email — `listUsers` is paged (fifty at a time,
   * no filter), so scanning it would miss every user past the first page — and because it does not
   * expose whether a password is set at all. The caller reads `auth.users` and `auth.identities`
   * directly; `auth.users.email` is uniquely indexed, so it is a single-row read.
   */
  findAuthUser: (where: { email: string } | { id: string }) => Promise<AuthUserFacts | null>;
  /**
   * A fresh client for one session exchange. `verifyOtp` leaves the resulting session on whichever
   * client performs it, and the admin client is long-lived and shared across requests in a Worker
   * isolate — so exchanging on it would let one person's session be read by the next request
   * through `admin.auth.getSession()`. A throwaway client is discarded with the session still on
   * it, which is the point.
   */
  sessionClient: () => SupabaseAdmin;
}

export function createWalletAccounts(config: WalletAccountsConfig): AccountProvisioner {
  return {
    async forAddress(namespace, address) {
      const email = syntheticEmail(namespace, address, config.emailDomain);
      const created = await config.admin.auth.admin.createUser({
        email,
        email_confirm: true,
        // The namespace only, never the address. `user_metadata` is carried in the access token
        // and exposed on `session.user`, which the browser already reads
        // (apps/web/src/features/auth/lib/account.ts). Putting the address here would undo the
        // reason the local part of `email` is a digest: it would disclose which wallet an account
        // belongs to, on every request, to anything that reads a user. `identity.wallet_links` is
        // the authoritative record of that link and nothing needs a second copy in a token.
        user_metadata: { wallet_namespace: namespace },
        // The server-only marker that this is a wallet sign-in account. `app_metadata` is writable
        // only with the secret key and is carried in the access token, so it is what the API reads
        // to exempt the account from studio-only rules — never the email, whose domain anyone can
        // register while email sign-up is open.
        app_metadata: { [WALLET_ACCOUNT_METADATA_KEY]: WALLET_ACCOUNT_METADATA_VALUE },
      });
      if (created.data.user) {
        return { userId: created.data.user.id, created: true };
      }
      // Already there. Usually two first-time sign-ins for one address raced and this one lost,
      // and the winner's account is the account. But the email is computable from the address, so
      // it may instead be an account somebody registered by hand to take this wallet's sign-in:
      // accepted only if wallet sign-in made it (`walletAccountVerdict`).
      const existing = await config.findAuthUser({ email: email.toLowerCase() });
      if (!existing) {
        throw created.error ?? new Error("Could not create or find the account for that wallet");
      }
      const verdict = walletAccountVerdict(existing, email);
      if (verdict !== "wallet" && verdict !== "legacy") {
        refuse(namespace, address, existing.id);
      }
      return { userId: existing.id, created: false };
    },

    /**
     * Core calls this only for an account `forAddress` made in the same call. It is checked again
     * here all the same, because a delete cannot be taken back: the account must be this
     * address's own synthetic one and carry the marker `forAddress` creates it with. Anything
     * else — an email account, another address's, one somebody registered — is refused.
     */
    async discardAccount(userId, namespace, address) {
      const user = await config.findAuthUser({ id: userId });
      if (!user) {
        return;
      }
      const verdict = walletAccountVerdict(
        user,
        syntheticEmail(namespace, address, config.emailDomain),
      );
      if (verdict !== "wallet") {
        throw new Error(
          "That account is not one wallet sign-in made for this address: not removed",
        );
      }
      const { error } = await config.admin.auth.admin.deleteUser(userId);
      if (error) {
        const digest = syntheticEmail(namespace, address, "x").split("@")[0];
        console.warn(
          `[wallet-auth] could not remove the unlinked account ${userId} made for ${digest}`,
        );
        throw error;
      }
    },

    async isOwnWalletAccount(userId, namespace, address) {
      const user = await config.findAuthUser({ id: userId });
      return (
        user !== null &&
        walletAccountVerdict(user, syntheticEmail(namespace, address, config.emailDomain)) ===
          "wallet"
      );
    },

    async markWalletAccount(userId, namespace, address) {
      const user = await config.findAuthUser({ id: userId });
      if (!user) {
        throw new Error("Could not read the account for that wallet");
      }
      // Runs on every sign-in, before the session is minted, so it is also the returning path's
      // check: an address linked to a hand-registered account before this check existed is
      // refused here rather than handed a session.
      const verdict = walletAccountVerdict(
        user,
        syntheticEmail(namespace, address, config.emailDomain),
      );
      if (verdict === "conflict") {
        refuse(namespace, address, user.id);
      }
      if (verdict !== "legacy") {
        return;
      }
      const updated = await config.admin.auth.admin.updateUserById(userId, {
        app_metadata: {
          ...user.appMetadata,
          [WALLET_ACCOUNT_METADATA_KEY]: WALLET_ACCOUNT_METADATA_VALUE,
        },
      });
      if (updated.error) {
        throw updated.error;
      }
    },

    async session(userId) {
      const { data: user, error: userError } = await config.admin.auth.admin.getUserById(userId);
      if (userError || !user.user?.email) {
        throw userError ?? new Error("That account has no address to mint a session against");
      }
      // generateLink does not send mail — it returns the link and token for a custom provider to
      // send, which is what makes it usable against an address that can never receive one.
      const { data: link, error: linkError } = await config.admin.auth.admin.generateLink({
        type: "magiclink",
        email: user.user.email,
      });
      if (linkError || !link.properties?.hashed_token) {
        throw linkError ?? new Error("Could not mint a session for that account");
      }
      const { data: session, error: otpError } = await config.sessionClient().auth.verifyOtp({
        token_hash: link.properties.hashed_token,
        type: "magiclink",
      });
      if (otpError || !session.session) {
        throw otpError ?? new Error("Could not mint a session for that account");
      }
      return {
        accessToken: session.session.access_token,
        refreshToken: session.session.refresh_token,
      };
    },
  };
}

/** The one call `createAuthUserLookup` makes on a pool, so a test can hand it a fake. */
interface Queryable {
  query<Row>(text: string, values: unknown[]): Promise<{ rows: Row[] }>;
}

/** PostgreSQL's undefined_table: `auth.users` does not exist on a plain local database. */
const UNDEFINED_TABLE = "42P01";

/**
 * `findAuthUser` for the API. Where `auth.users` is reachable — a deployment, whose `DATABASE` is
 * the hosted project's PostgreSQL — it reads the user, whether a password is set and every identity
 * provider in one row. On a local run, whose database is a plain PostgreSQL with no `auth` schema,
 * it falls back to the admin API, which can read by id but not by email and never says whether a
 * password is set (`hasPassword: null`), so there only marked accounts are accepted.
 */
export function createAuthUserLookup(deps: {
  pool: Queryable;
  admin: SupabaseAdmin;
}): WalletAccountsConfig["findAuthUser"] {
  return async (where) => {
    const byEmail = "email" in where;
    try {
      const { rows } = await deps.pool.query<{
        id: string;
        email: string | null;
        has_password: boolean;
        providers: string[];
        app_metadata: Record<string, unknown> | null;
      }>(
        `SELECT u.id, u.email,
                coalesce(u.encrypted_password, '') <> '' AS has_password,
                coalesce(
                  (SELECT array_agg(i.provider) FROM auth.identities i WHERE i.user_id = u.id),
                  '{}'
                ) AS providers,
                u.raw_app_meta_data AS app_metadata
           FROM auth.users u
          WHERE ${byEmail ? "u.email = $1" : "u.id = $1::uuid"}
          LIMIT 1`,
        [byEmail ? where.email : where.id],
      );
      const row = rows[0];
      return row
        ? {
            id: row.id,
            email: row.email,
            hasPassword: row.has_password,
            providers: row.providers,
            appMetadata: row.app_metadata ?? {},
          }
        : null;
    } catch (error) {
      if ((error as { code?: unknown }).code !== UNDEFINED_TABLE) {
        throw error;
      }
    }
    if (byEmail) {
      return null;
    }
    const { data, error } = await deps.admin.auth.admin.getUserById(where.id);
    if (error || !data.user) {
      return null;
    }
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      hasPassword: null,
      providers: (data.user.identities ?? []).map((identity) => identity.provider),
      appMetadata: (data.user.app_metadata ?? {}) as Record<string, unknown>,
    };
  };
}
