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
     * Refused with `WalletRequiredError` until the caller has a custody account: the username is
     * saved only once the passkey and the master wallet exist.
     */
    async createProfile(
      userId: string,
      input: { displayName: string; handle: string },
    ): Promise<Profile> {
      const displayName = parseDisplayName(input.displayName);
      const handle = normalizeHandle(input.handle);
      const problem = handleProblem(handle);
      if (problem) {
        throw new InvalidProfileError("handle", problem);
      }
      if (!(await custody.hasCustodyAccount(userId))) {
        throw new WalletRequiredError();
      }

      const existing = await repository.findByUserId(userId);
      if (existing) {
        if (existing.handle === handle) {
          return existing;
        }
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
