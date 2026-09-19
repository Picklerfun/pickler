// Ported from Relayer apps/api/src/api/filters/global-exception.filter.ts (commit bb6bb1226e92).
// Business errors from core map to statuses here instead of NestJS exceptions.

import {
  AccessDeniedError,
  AgentAuthenticationError,
  AgentNotFoundError,
  InvalidProfileError,
  ProfileAlreadyExistsError,
  ProfileHandleTakenError,
  AuthenticationRequiredError,
  DataSourceUnavailableError,
  InactiveWorkspaceError,
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
  if (error instanceof ProfileAlreadyExistsError) {
    return {
      status: 409,
      message: error.message,
      extras: { error: "profile_exists", detail: error.profile.handle },
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
  const isProduction = c.env?.APP_ENV === "production";
  const { status, message, extras } = classify(error, isProduction);
  if (status >= 500) {
    console.error(
      `[${traceId}] ${c.req.method} ${c.req.path}`,
      isProduction && error instanceof Error ? error.message : error,
    );
  }
  return c.json(errorEnvelope(message, status, c.req.path, traceId, extras), status);
}
