import type { AccountProvisioner, Namespace, NormalizedAddress } from "@pickler/core";
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
 * Note what this does *not* do: it adds no case rule of its own. `normalizeAddress` has already
 * decided the spelling — lower-cased for EVM, untouched for base58 — and lower-casing again here
 * would map two distinct Solana addresses onto one account. One normalisation rule, in one place.
 */
export function syntheticEmail(
  namespace: Namespace,
  address: NormalizedAddress,
  domain: string,
): string {
  return `${namespace}-${address}@${domain}`;
}

export interface WalletAccountsConfig {
  admin: SupabaseAdmin;
  /** e.g. "wallet.pickler.fun". Never deliverable. */
  emailDomain: string;
  /**
   * Looks up an auth user by their synthetic address, or null. Injected because the Supabase admin
   * API has no lookup by email — `getUserById` is its only direct read, and `listUsers` is paged
   * (fifty at a time, no filter), so scanning it would miss every user past the first page and
   * grow without bound. `auth.users.email` is uniquely indexed, so the caller's implementation is
   * a single-row read.
   */
  findUserIdByEmail: (email: string) => Promise<string | null>;
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
        user_metadata: { wallet_namespace: namespace, wallet_address: address },
      });
      if (created.data.user) {
        return { userId: created.data.user.id };
      }
      // Already there: two first-time sign-ins for one address raced and this one lost. Not an
      // error — the winner's account is the account.
      const existing = await config.findUserIdByEmail(email);
      if (!existing) {
        throw created.error ?? new Error("Could not create or find the account for that wallet");
      }
      return { userId: existing };
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
