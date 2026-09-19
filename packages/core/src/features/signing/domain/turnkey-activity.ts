// Ported from Relayer apps/api/src/kits/signing/turnkey/turnkey-activity-forwarder.service.ts types
// (commit bb6bb1226e92).

export const TERMINAL_ACTIVITY_STATUSES = [
  "ACTIVITY_STATUS_COMPLETED",
  "ACTIVITY_STATUS_FAILED",
  "ACTIVITY_STATUS_REJECTED",
  "ACTIVITY_STATUS_CONSENSUS_NEEDED",
] as const;

export interface TurnkeyActivity {
  id: string;
  fingerprint: string;
  status: string;
  organizationId?: string | undefined;
  type?: string | undefined;
  failure?: { message?: string } | undefined;
  /** Heterogeneous per intent; callers narrow by key (e.g. result.signTransactionResult). */
  result?: Record<string, Record<string, unknown> | undefined> | undefined;
  votes?: { vote?: string }[] | undefined;
}

/** A request stamped in the browser by the user's passkey. The server forwards it unchanged. */
export interface SignedActivityRequest {
  url: string;
  body: string;
  stamp: { stampHeaderName: string; stampHeaderValue: string };
}

export interface ForwardExpectations {
  /** The workspace's Turnkey sub-organization; the signed body must target it. */
  organizationId: string;
  /** Activity types this caller may forward, e.g. ["ACTIVITY_TYPE_CREATE_WALLET"]. */
  allowedActivityTypes: readonly string[];
}

export const isTerminalActivity = (status: string) =>
  (TERMINAL_ACTIVITY_STATUSES as readonly string[]).includes(status);

/** The signed request does not match what this caller may forward (HTTP 400). */
export class InvalidSignedActivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSignedActivityError";
  }
}

/** Turnkey refused the request (4xx); the message is safe to show (HTTP 400). */
export class SignedActivityRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignedActivityRejectedError";
  }
}

/** Turnkey could not be reached or failed (5xx, network, empty response) (HTTP 502). */
export class SigningServiceUnavailableError extends Error {
  constructor(
    message = "Failed to communicate with signing service",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SigningServiceUnavailableError";
  }
}
