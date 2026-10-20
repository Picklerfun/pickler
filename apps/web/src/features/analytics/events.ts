/**
 * Property builders for product events. They never accept an email: the waitlist stores that
 * address in the product database, and the application request that follows does not carry it.
 */

const CAMPAIGN_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type CampaignKey = (typeof CAMPAIGN_KEYS)[number];

export type AnalyticsValue = string | number | boolean;

const MAX_CAMPAIGN_LENGTH = 200;

/** Current-page campaign parameters. An `email` query value is ignored. */
export function campaignProperties(search: string): Partial<Record<CampaignKey, string>> {
  const params = new URLSearchParams(search);
  const properties: Partial<Record<CampaignKey, string>> = {};
  for (const key of CAMPAIGN_KEYS) {
    const value = params.get(key)?.trim();
    if (value) {
      properties[key] = value.slice(0, MAX_CAMPAIGN_LENGTH);
    }
  }
  return properties;
}

export function waitlistSignupProperties(input: {
  search: string;
  path: string;
  alreadyJoined: boolean;
  position: number;
  referralPresent: boolean;
}): Record<string, AnalyticsValue> {
  return {
    source: "create",
    path: input.path,
    already_joined: input.alreadyJoined,
    position: input.position,
    referral_present: input.referralPresent,
    ...campaignProperties(input.search),
  };
}

export type WaitlistFailureReason = "network" | "rejected" | "seat_held_elsewhere";

export function waitlistFailureProperties(input: {
  search: string;
  path: string;
  reason: WaitlistFailureReason;
  status?: number;
  errorCode?: string | null;
}): Record<string, AnalyticsValue> {
  const properties: Record<string, AnalyticsValue> = {
    source: "create",
    path: input.path,
    reason: input.reason,
    ...campaignProperties(input.search),
  };
  if (typeof input.status === "number") {
    properties.status = input.status;
  }
  if (input.errorCode) {
    properties.error_code = input.errorCode;
  }
  return properties;
}

export function ctaProperties(input: {
  cta: string;
  location: string;
  path: string;
}): Record<string, AnalyticsValue> {
  return {
    cta: input.cta,
    location: input.location,
    path: input.path,
  };
}
