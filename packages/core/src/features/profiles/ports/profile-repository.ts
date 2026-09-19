import type { Profile } from "../domain/profile.js";

export type CreateProfileResult =
  | { created: true; profile: Profile }
  | { created: false; reason: "handle_taken" | "user_has_profile" };

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
