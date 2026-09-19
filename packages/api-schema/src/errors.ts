import type { ApplicationFieldDto } from "./applications.js";

export type ApiErrorCode =
  | "invalid_request"
  | "invalid_email"
  | "invalid_application"
  | "no_seat"
  | "already_submitted"
  | "ticker_taken"
  | "handle_taken"
  | "unavailable"
  | "internal";

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Per-field messages for invalid_application, ticker_taken and handle_taken. */
    fields?: Partial<Record<ApplicationFieldDto, string>>;
  };
}
