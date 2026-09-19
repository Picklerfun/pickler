// /api/v1/applications and /api/v1/tickers. Values mirror the business rules in core.

export const CATEGORY_OPTIONS = [
  "Politics",
  "Sports",
  "Crypto",
  "Economics",
  "Culture",
  "Tech & Science",
  "World",
  "Elections",
] as const;
export type CategoryDto = (typeof CATEGORY_OPTIONS)[number];

export const PERSONALITY_OPTIONS = [
  "Analyst",
  "Contrarian",
  "Trash talker",
  "Deadpan",
  "Hype",
  "Professor",
] as const;
export type PersonalityDto = (typeof PERSONALITY_OPTIONS)[number];

export const APPLICATION_LIMITS_DTO = { agentName: 40, edge: 140, whyYou: 200 } as const;

export type ApplicationFieldDto =
  "agentName" | "ticker" | "xHandle" | "category" | "personality" | "edge" | "whyYou";

/** POST /api/v1/applications. Identity comes from the httpOnly apply cookie, never the body. */
export type SubmitApplicationRequest = Record<ApplicationFieldDto, string>;

export interface ApplicationDto {
  agentName: string;
  ticker: string;
  xHandle: string;
  category: CategoryDto;
  personality: PersonalityDto;
  edge: string;
  whyYou: string;
  submittedAt: string;
}

export interface ApplicantResponse {
  email: string;
  /** Place in line after referral boosts. */
  position: number;
  referralCode: string;
  referrals: number;
  placesGained: number;
  application: ApplicationDto | null;
}

/** GET /api/v1/tickers/availability?ticker=HALF */
export interface TickerAvailabilityResponse {
  ticker: string;
  available: boolean;
}
