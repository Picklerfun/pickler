import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
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
        // The namespace only, never the address. `user_metadata` is carried in the access token
        // and exposed on `session.user`, which the browser already reads
        // (apps/web/src/features/auth/lib/account.ts). Putting the address here would undo the
        // reason the local part of `email` is a digest: it would disclose which wallet an account
        // belongs to, on every request, to anything that reads a user. `identity.wallet_links` is
        // the authoritative record of that link and nothing needs a second copy in a token.
        user_metadata: { wallet_namespace: namespace },
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
