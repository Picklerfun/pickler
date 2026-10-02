// Ported from Relayer apps/api/src/api/filters/global-exception.filter.ts (commit bb6bb1226e92).
// Business errors from core map to statuses here instead of NestJS exceptions.

import {
  AccessDeniedError,
  AgentAuthenticationError,
  AgentNotFoundError,
  AgentWalletNotFoundError,
  DelegatedKeyNotConfiguredError,
  DelegatedUserExistsError,
  DelegatedUserMissingError,
  InvalidProfileError,
  ProfileAlreadyExistsError,
  ProfileHandleTakenError,
  WalletRequiredError,
  AuthenticationRequiredError,
  ChallengeNotUsableError,
  DataSourceUnavailableError,
  InactiveWorkspaceError,
  InvalidSignedActivityError,
  NoCustodyAccountError,
  SignedActivityRejectedError,
  SigningServiceUnavailableError,
  WalletUnderfundedError,
  AgentWalletLinkedError,
  BalancesUnreadableError,
} from "@pickler/core";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";
import { errorEnvelope, type ErrorExtras } from "./envelope";
import { HttpError } from "./http-error";

function classify(
  error: unknown,
  isProduction: boolean,
): { status: ContentfulStatusCode; message: string; extras?: ErrorExtras } {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      message: error.message,
      ...(error.extras ? { extras: error.extras } : {}),
    };
  }
  if (error instanceof HTTPException) {
    return {
      status: error.status as ContentfulStatusCode,
      message: error.message || "Request failed",
    };
  }
  if (error instanceof AuthenticationRequiredError || error instanceof InactiveWorkspaceError) {
    return { status: 401, message: error.message };
  }
  if (error instanceof AgentAuthenticationError) {
    return { status: 401, message: error.message, extras: { error: error.code } };
  }
  if (error instanceof AccessDeniedError) {
    return { status: 403, message: error.message };
  }
  if (error instanceof AgentNotFoundError) {
    return { status: 404, message: error.message };
  }
  if (error instanceof InvalidProfileError) {
    return {
      status: 400,
      message: error.message,
      extras: { error: "invalid_profile", code: error.field, reason: error.problem },
    };
  }
  if (error instanceof ProfileHandleTakenError) {
    return {
      status: 409,
      message: error.message,
      extras: { error: "handle_taken", code: "handle" },
    };
  }
  if (error instanceof WalletRequiredError) {
    return { status: 409, message: error.message, extras: { error: "wallet_required" } };
  }
  if (error instanceof ProfileAlreadyExistsError) {
    return {
      status: 409,
      message: error.message,
      extras: { error: "profile_exists", detail: error.profile.handle },
    };
  }
  if (error instanceof ChallengeNotUsableError) {
    return { status: 400, message: error.message, extras: { error: "challenge_expired" } };
  }
  if (error instanceof NoCustodyAccountError) {
    return { status: 409, message: error.message, extras: { error: "no_custody_account" } };
  }
  if (error instanceof DelegatedUserExistsError) {
    return { status: 409, message: error.message, extras: { error: "delegated_user_exists" } };
  }
  if (error instanceof DelegatedUserMissingError) {
    return { status: 409, message: error.message, extras: { error: "delegated_user_missing" } };
  }
  if (error instanceof AgentWalletNotFoundError) {
    return { status: 404, message: error.message, extras: { error: "agent_wallet_not_found" } };
  }
  if (error instanceof AgentWalletLinkedError) {
    return { status: 409, message: error.message, extras: { error: "wallet_assigned" } };
  }
  if (error instanceof WalletUnderfundedError) {
    // Base units as strings: the balances read on chain and the minimums. A balance that could not
    // be read is BalancesUnreadableError (503), never underfunded.
    return {
      status: 409,
      message: error.message,
      extras: { error: "wallet_underfunded", detail: { ...error.detail } },
    };
  }
  if (error instanceof BalancesUnreadableError) {
    // The chain did not answer: an outage, never an underfunded wallet.
    return { status: 503, message: error.message, extras: { error: "balances_unavailable" } };
  }
  if (error instanceof DelegatedKeyNotConfiguredError) {
    return {
      status: 503,
      message: error.message,
      extras: { error: "agent_wallets_unavailable" },
    };
  }
  if (error instanceof InvalidSignedActivityError) {
    // Our own check on what the browser stamped; the message says which rule it broke.
    return { status: 400, message: error.message, extras: { error: "invalid_signed_activity" } };
  }
  if (error instanceof SignedActivityRejectedError) {
    // Turnkey's own words for why it refused, as in Relayer. The forwarder has already made
    // sure the request targeted the caller's own sub-organization, so a message that quotes an
    // organisation quotes theirs.
    return { status: 400, message: error.message, extras: { error: "activity_rejected" } };
  }
  if (error instanceof SigningServiceUnavailableError) {
    // Fixed text, unlike the branch above: this error's message interpolates whatever a 5xx
    // body said, which is the upstream's internal business and not the browser's.
    return {
      status: 502,
      message: "Signing service unavailable",
      extras: { error: "signing_unavailable" },
    };
  }
  if (error instanceof DataSourceUnavailableError) {
    return { status: 503, message: "Service temporarily unavailable" };
  }
  const message =
    !isProduction && error instanceof Error && error.message
      ? error.message
      : "Internal server error";
  return { status: 500, message };
}

export function handleError(error: unknown, c: Context<AppEnv>) {
  const traceId = c.get("requestId") ?? crypto.randomUUID();
  const isProduction = c.env?.APP_ENV !== "local";
  const { status, message, extras } = classify(error, isProduction);
  if (status >= 500) {
    console.error(`[${traceId}] ${c.req.method} ${c.req.path}`, `HTTP ${status}`);
  } else if (extras?.error === "activity_rejected" || !isProduction) {
    // Turnkey's refusal is the only clue to a custody failure, and the browser alone saw it; in
    // a local run every refusal is worth a line. The text names no secret: it is exactly what the
    // envelope already hands back to the caller.
    console.warn(
      `[${traceId}] ${c.req.method} ${c.req.path}`,
      `HTTP ${status}`,
      message,
      extras?.error ?? "",
    );
  }
  return c.json(errorEnvelope(message, status, c.req.path, traceId, extras), status);
}
