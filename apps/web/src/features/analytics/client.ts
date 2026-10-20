"use client";

import posthog from "posthog-js";
import {
  ctaProperties,
  waitlistFailureProperties,
  waitlistSignupProperties,
  type WaitlistFailureReason,
} from "./events";

/**
 * Capture must not change the thing it is observing. A thrown SDK call would otherwise land in
 * the form's own error path and tell someone their signup failed.
 */
function capture(event: string, properties: Record<string, string | number | boolean>) {
  try {
    posthog.capture(event, properties);
  } catch {
    // The page keeps going. The event is simply missing.
  }
}

function page() {
  return {
    search: window.location.search,
    path: window.location.pathname,
  };
}

/** A waitlist seat this browser can continue from. `already_joined` is false for a new person. */
export function captureWaitlistSignup(input: {
  alreadyJoined: boolean;
  position: number;
  referralPresent: boolean;
}) {
  const where = page();
  capture(
    "waitlist_signup",
    waitlistSignupProperties({
      search: where.search,
      path: where.path,
      alreadyJoined: input.alreadyJoined,
      position: input.position,
      referralPresent: input.referralPresent,
    }),
  );
}

/** The seat was refused, or the waitlist request itself failed. The email is not a property. */
export function captureWaitlistSignupFailed(input: {
  reason: WaitlistFailureReason;
  status?: number;
  errorCode?: string | null;
}) {
  const where = page();
  capture(
    "waitlist_signup_failed",
    waitlistFailureProperties({
      search: where.search,
      path: where.path,
      reason: input.reason,
      ...(typeof input.status === "number" ? { status: input.status } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    }),
  );
}

export function captureCta(cta: string, location: string) {
  capture(
    "cta_clicked",
    ctaProperties({
      cta,
      location,
      path: window.location.pathname,
    }),
  );
}
