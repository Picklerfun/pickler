export const CATEGORIES = [
  "Politics",
  "Sports",
  "Crypto",
  "Economics",
  "Culture",
  "Tech & Science",
  "World",
  "Elections",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PERSONALITIES = [
  "Analyst",
  "Contrarian",
  "Trash talker",
  "Deadpan",
  "Hype",
  "Professor",
] as const;
export type Personality = (typeof PERSONALITIES)[number];

export const APPLICATION_LIMITS = { agentName: 40, edge: 140, whyYou: 200 } as const;

/** Places an applicant moves up for each referred creator who submits an application. */
export const REFERRAL_BOOST = 20;

export type ApplicationField =
  "agentName" | "ticker" | "xHandle" | "category" | "personality" | "edge" | "whyYou";

/** Untrusted answers as typed by the applicant. */
export type ApplicationInput = Record<ApplicationField, string>;

export interface Application {
  agentName: string;
  /** "$" followed by 2–6 upper-case letters or digits, starting with a letter. */
  ticker: string;
  /** "@" followed by a valid X username. */
  xHandle: string;
  category: Category;
  personality: Personality;
  edge: string;
  whyYou: string;
}

export interface Applicant {
  email: string;
  /** 1-based place in the waitlist, before referral boosts. */
  linePosition: number;
  referralCode: string;
  /** Referred creators who have submitted an application. */
  referrals: number;
  application: (Application & { submittedAt: Date }) | null;
}

export interface FieldIssue {
  field: ApplicationField;
  message: string;
}

export class ApplicationValidationError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    super("Invalid application");
    this.name = "ApplicationValidationError";
  }
}

export class ApplicantNotFoundError extends Error {
  constructor() {
    super("No waitlist seat for this applicant");
    this.name = "ApplicantNotFoundError";
  }
}

export class ApplicationAlreadySubmittedError extends Error {
  constructor() {
    super("Application already submitted");
    this.name = "ApplicationAlreadySubmittedError";
  }
}

export class TickerTakenError extends Error {
  constructor(readonly ticker: string) {
    super(`Ticker ${ticker} is taken`);
    this.name = "TickerTakenError";
  }
}

export class HandleTakenError extends Error {
  constructor(readonly xHandle: string) {
    super(`X account ${xHandle} is already registered`);
    this.name = "HandleTakenError";
  }
}

const TICKER_PATTERN = /^\$[A-Z][A-Z0-9]{1,5}$/;
const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const REFERRAL_CODE_PATTERN = /^[a-z0-9]{6,12}$/;

/** "$half", "HALF" → "$HALF"; null when it cannot be a ticker. */
export function normalizeTicker(raw: string): string | null {
  const ticker = `$${raw.trim().replace(/^\$+/, "").toUpperCase()}`;
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

/** "halftimebot", "@halftimebot", "https://x.com/halftimebot" → "@halftimebot"; null when invalid. */
export function normalizeXHandle(raw: string): string | null {
  const handle = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
    .replace(/^@+/, "")
    .replace(/\/+$/, "");
  return HANDLE_PATTERN.test(handle) ? `@${handle}` : null;
}

/** Referral codes from links are untrusted; anything malformed is ignored. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = raw?.trim().toLowerCase() ?? "";
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

export function validateApplication(input: ApplicationInput): Application {
  const issues: FieldIssue[] = [];
  const text = (field: "agentName" | "edge" | "whyYou", max: number) => {
    const value = input[field].trim();
    if (!value) {
      issues.push({ field, message: "Required." });
    } else if (value.length > max) {
      issues.push({ field, message: `Keep it under ${max} characters.` });
    }
    return value;
  };

  const agentName = text("agentName", APPLICATION_LIMITS.agentName);
  const edge = text("edge", APPLICATION_LIMITS.edge);
  const whyYou = text("whyYou", APPLICATION_LIMITS.whyYou);

  const ticker = normalizeTicker(input.ticker);
  if (!ticker) {
    issues.push({
      field: "ticker",
      message: "Use 2 to 6 letters or digits, starting with a letter.",
    });
  }

  const xHandle = normalizeXHandle(input.xHandle);
  if (!xHandle) {
    issues.push({ field: "xHandle", message: "Enter a valid X username." });
  }

  const category = CATEGORIES.find((c) => c === input.category);
  if (!category) {
    issues.push({ field: "category", message: "Pick a category." });
  }

  const personality = PERSONALITIES.find((p) => p === input.personality);
  if (!personality) {
    issues.push({ field: "personality", message: "Pick a personality." });
  }

  if (issues.length > 0 || !ticker || !xHandle || !category || !personality) {
    throw new ApplicationValidationError(issues);
  }
  return { agentName, ticker, xHandle, category, personality, edge, whyYou };
}

export function effectiveLinePosition(
  applicant: Pick<Applicant, "linePosition" | "referrals">,
): number {
  return Math.max(1, applicant.linePosition - applicant.referrals * REFERRAL_BOOST);
}
