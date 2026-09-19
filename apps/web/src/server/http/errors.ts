import "server-only";
import {
  ApplicantNotFoundError,
  ApplicationAlreadySubmittedError,
  ApplicationValidationError,
  DataSourceUnavailableError,
  HandleTakenError,
  InvalidEmailError,
  TickerTakenError,
} from "@pickler/core";
import type { ApiErrorCode, ApiErrorResponse } from "@pickler/api-schema";

const noStore = { "Cache-Control": "no-store" };

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: ApiErrorResponse["error"]["fields"],
) {
  const body: ApiErrorResponse = { error: { code, message, ...(fields ? { fields } : {}) } };
  return Response.json(body, { status, headers: noStore });
}

/** Maps known business failures to safe HTTP errors; details are logged, never returned. */
export function toErrorResponse(error: unknown) {
  if (error instanceof InvalidEmailError) {
    return errorResponse(400, "invalid_email", "Enter a valid email address.");
  }
  if (error instanceof ApplicationValidationError) {
    const fields = Object.fromEntries(error.issues.map((issue) => [issue.field, issue.message]));
    return errorResponse(400, "invalid_application", "Some answers need another look.", fields);
  }
  if (error instanceof ApplicantNotFoundError) {
    return errorResponse(401, "no_seat", "Join the waitlist from this browser first.");
  }
  if (error instanceof ApplicationAlreadySubmittedError) {
    return errorResponse(409, "already_submitted", "This application is already in.");
  }
  if (error instanceof TickerTakenError) {
    return errorResponse(409, "ticker_taken", `${error.ticker} is taken.`, {
      ticker: `${error.ticker} is taken. Try another.`,
    });
  }
  if (error instanceof HandleTakenError) {
    return errorResponse(409, "handle_taken", `${error.xHandle} is already registered.`, {
      xHandle: `${error.xHandle} is already registered.`,
    });
  }
  if (error instanceof DataSourceUnavailableError) {
    console.error(error.message, error.cause);
    return errorResponse(503, "unavailable", "Service temporarily unavailable.");
  }
  console.error(error);
  return errorResponse(500, "internal", "Unexpected error.");
}
