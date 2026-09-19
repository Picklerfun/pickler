import { normalizeReferralCode } from "../../applications/domain/application.js";
import type { ApplicantRepository } from "../../applications/ports/applicant-repository.js";
import { normalizeEmail } from "../domain/email.js";
import type { WaitlistPlacement, WaitlistRepository } from "../ports/waitlist-repository.js";

export interface JoinWaitlistOptions {
  referralCode?: string | null;
  /** Apply token this browser already holds, if any. */
  currentToken?: string | null;
}

export function createJoinWaitlist(waitlist: WaitlistRepository, applicants: ApplicantRepository) {
  return async (
    rawEmail: string,
    options: JoinWaitlistOptions = {},
  ): Promise<WaitlistPlacement> => {
    const email = normalizeEmail(rawEmail);
    const placement = await waitlist.join(email, normalizeReferralCode(options.referralCode));
    if (!placement.alreadyJoined || !options.currentToken) {
      return placement;
    }

    // Knowing an email is not proof of owning the seat. Only a browser that already
    // holds that seat's token gets it back.
    const holder = await applicants.findByToken(options.currentToken);
    return holder?.email === email ? { ...placement, applyToken: options.currentToken } : placement;
  };
}
