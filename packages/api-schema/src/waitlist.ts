// POST /api/v1/waitlist

export interface JoinWaitlistRequest {
  email: string;
  /** Referral code from a creator's share link. */
  ref?: string;
}

export interface JoinWaitlistResponse {
  position: number;
  alreadyJoined: boolean;
  /** True when this browser now holds the apply cookie and can continue to /apply. */
  canApply: boolean;
}
