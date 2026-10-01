import type { Profile } from "../domain/profile.js";

export type CreateProfileResult =
  | { created: true; profile: Profile }
  | { created: false; reason: "handle_taken" | "user_has_profile" };

/**
 * Whether the user has a custody account (a Turnkey sub-organization with its master wallet). A
 * profile is refused without one: see `WalletRequiredError`.
 */
export interface CustodyAccountLookup {
  hasCustodyAccount(userId: string): Promise<boolean>;
}

export interface ProfileRepository {
  findByUserId(userId: string): Promise<Profile | null>;
  isHandleTaken(handle: string): Promise<boolean>;
  /** Atomic: the handle and the user id are both unique. */
  create(profile: {
    userId: string;
    displayName: string;
    handle: string;
  }): Promise<CreateProfileResult>;
}
