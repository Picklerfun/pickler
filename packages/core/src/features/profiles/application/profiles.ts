import {
  handleProblem,
  InvalidProfileError,
  normalizeHandle,
  parseDisplayName,
  ProfileAlreadyExistsError,
  ProfileHandleTakenError,
  WalletRequiredError,
  type HandleProblem,
  type Profile,
} from "../domain/profile.js";
import type { CustodyAccountLookup, ProfileRepository } from "../ports/profile-repository.js";

/**
 * Who is creating the profile. `studio` is an email or Google account, which must have its custody
 * account (the passkey's sub-organization and master wallet) first. `wallet` is a wallet sign-in
 * account, whose own external wallet is its wallet and which never has a custody account; it claims
 * a handle from the marketplace portfolio. The caller decides from the verified token's server-only
 * `app_metadata` marker (`UserPrincipal.walletAccount`), never from the email or the request body.
 */
export type ProfileAccount = "studio" | "wallet";

export type HandleAvailability =
  | { handle: string; available: true }
  | { handle: string; available: false; reason: HandleProblem | "taken" };

export function createProfileService(repository: ProfileRepository, custody: CustodyAccountLookup) {
  return {
    async checkHandle(raw: string): Promise<HandleAvailability> {
      const handle = normalizeHandle(raw);
      const problem = handleProblem(handle);
      if (problem) {
        return { handle, available: false, reason: problem };
      }
      return (await repository.isHandleTaken(handle))
        ? { handle, available: false, reason: "taken" }
        : { handle, available: true };
    },

    getProfile: (userId: string) => repository.findByUserId(userId),

    /**
     * Creates the caller's profile. Repeating the same request returns the existing profile, so a
     * client retry after a lost response is safe; a different handle for an existing profile conflicts.
     *
     * Otherwise a studio account is refused with `WalletRequiredError` until it has a custody
     * account: the username is saved only once the passkey and the master wallet exist. A wallet
     * sign-in account is not asked.
     */
    async createProfile(
      userId: string,
      input: { displayName: string; handle: string },
      account: ProfileAccount,
    ): Promise<Profile> {
      const displayName = parseDisplayName(input.displayName);
      const handle = normalizeHandle(input.handle);
      const problem = handleProblem(handle);
      if (problem) {
        throw new InvalidProfileError("handle", problem);
      }
      // The replay comes first: a retry answers the profile that exists, whatever has happened
      // to the account's wallet since.
      const existing = await repository.findByUserId(userId);
      if (existing?.handle === handle) {
        return existing;
      }
      if (account === "studio" && !(await custody.hasCustodyAccount(userId))) {
        throw new WalletRequiredError();
      }
      if (existing) {
        throw new ProfileAlreadyExistsError(existing);
      }

      const result = await repository.create({ userId, displayName, handle });
      if (result.created) {
        return result.profile;
      }
      if (result.reason === "handle_taken") {
        throw new ProfileHandleTakenError(handle);
      }
      // Lost a race with another request from the same user.
      const current = await repository.findByUserId(userId);
      if (current?.handle === handle) {
        return current;
      }
      throw new ProfileAlreadyExistsError(current!);
    },
  };
}
