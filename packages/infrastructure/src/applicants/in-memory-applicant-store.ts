import type {
  Applicant,
  ApplicantRepository,
  Application,
  WaitlistRepository,
} from "@pickler/core";

interface Seat {
  email: string;
  position: number;
  token: string;
  referralCode: string;
  referredBy: string | null;
  application: (Application & { submittedAt: Date }) | null;
}

export interface InMemoryApplicantStoreOptions {
  /** Seats assumed to exist before this process started. */
  initialCount?: number;
  /** Tickers already used by live agents. */
  reservedTickers?: string[];
  now?: () => Date;
}

/**
 * Process-local waitlist and applications for sample mode. Data is lost on restart and
 * is not shared between server instances; never use it where signups must be kept.
 */
export function createInMemoryApplicantStore(options: InMemoryApplicantStoreOptions = {}): {
  waitlist: WaitlistRepository;
  applicants: ApplicantRepository;
} {
  const { initialCount = 0, reservedTickers = [], now = () => new Date() } = options;
  const byEmail = new Map<string, Seat>();
  const byToken = new Map<string, Seat>();
  const reserved = new Set(reservedTickers);

  const toApplicant = (seat: Seat): Applicant => ({
    email: seat.email,
    linePosition: seat.position,
    referralCode: seat.referralCode,
    referrals: [...byEmail.values()].filter(
      (s) => s.referredBy === seat.referralCode && s.application,
    ).length,
    application: seat.application,
  });

  const waitlist: WaitlistRepository = {
    async join(email, referralCode) {
      const existing = byEmail.get(email);
      if (existing) {
        return { position: existing.position, alreadyJoined: true, applyToken: null };
      }
      const referrer = referralCode
        ? [...byEmail.values()].find((s) => s.referralCode === referralCode)
        : undefined;
      const seat: Seat = {
        email,
        position: initialCount + byEmail.size + 1,
        token: crypto.randomUUID(),
        referralCode: crypto.randomUUID().replaceAll("-", "").slice(0, 10),
        referredBy: referrer?.referralCode ?? null,
        application: null,
      };
      byEmail.set(email, seat);
      byToken.set(seat.token, seat);
      return { position: seat.position, alreadyJoined: false, applyToken: seat.token };
    },
  };

  const tickerTaken = (ticker: string) =>
    reserved.has(ticker) || [...byToken.values()].some((s) => s.application?.ticker === ticker);

  const applicants: ApplicantRepository = {
    async findByToken(token) {
      const seat = byToken.get(token);
      return seat ? toApplicant(seat) : null;
    },
    async submit(token, application) {
      const seat = byToken.get(token);
      if (!seat) {
        return "not_found";
      }
      if (seat.application) {
        return "already_submitted";
      }
      if (tickerTaken(application.ticker)) {
        return "ticker_taken";
      }
      const handle = application.xHandle.toLowerCase();
      if ([...byToken.values()].some((s) => s.application?.xHandle.toLowerCase() === handle)) {
        return "handle_taken";
      }
      seat.application = { ...application, submittedAt: now() };
      return "submitted";
    },
    async isTickerAvailable(ticker) {
      return !tickerTaken(ticker);
    },
  };

  return { waitlist, applicants };
}
