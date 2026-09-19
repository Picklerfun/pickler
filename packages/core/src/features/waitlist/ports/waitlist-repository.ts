export interface WaitlistPlacement {
  /** 1-based position in line. */
  position: number;
  alreadyJoined: boolean;
  /** Secret that unlocks the application. Issued only when the seat is created. */
  applyToken: string | null;
}

export interface WaitlistRepository {
  /**
   * Idempotent per normalized email. A referral code is recorded only for new seats.
   * Rejects with DataSourceUnavailableError on failure.
   */
  join(email: string, referralCode: string | null): Promise<WaitlistPlacement>;
}
