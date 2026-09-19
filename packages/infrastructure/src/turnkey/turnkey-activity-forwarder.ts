// Ported from Relayer apps/api/src/kits/signing/turnkey/turnkey-activity-forwarder.service.ts
// (commit bb6bb1226e92).
// Behaviour changes:
// - Besides the origin check, only /public/v1/submit/* paths and allow-listed activity types are
//   forwarded, and the signed body must target the caller's sub-organization. Relayer forwarded
//   any passkey-stamped request to any Turnkey path.
// - The signed body is not logged (Relayer logged it in full).
// - Polling uses the parent-key reader over the Workers transport; delays are injectable.

import {
  InvalidSignedActivityError,
  isTerminalActivity,
  SigningServiceUnavailableError,
  type SignedActivityForwarder,
  type TurnkeyActivity,
  type TurnkeyReader,
} from "@pickler/core";
import {
  sendStampedRequest,
  TURNKEY_API_BASE_URL,
  type TurnkeyTransportConfig,
} from "./turnkey-transport.js";

export interface ActivityForwarderConfig extends TurnkeyTransportConfig {
  reader: TurnkeyReader;
  pollAttempts?: number;
  pollDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const SUBMIT_PATH = /^\/public\/v1\/submit\/[a-z0-9_]+$/;

export function createTurnkeyActivityForwarder(
  config: ActivityForwarderConfig,
): SignedActivityForwarder {
  const base = new URL(config.baseUrl ?? TURNKEY_API_BASE_URL);
  const pollAttempts = config.pollAttempts ?? 3;
  const pollDelayMs = config.pollDelayMs ?? 1000;
  const sleep =
    config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    async forward(request, expectations) {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        throw new InvalidSignedActivityError("Invalid activity URL");
      }
      if (url.origin !== base.origin) {
        throw new InvalidSignedActivityError(
          `Invalid activity URL: must be a Turnkey API endpoint (expected origin: ${base.origin})`,
        );
      }
      if (!SUBMIT_PATH.test(url.pathname) || url.search) {
        throw new InvalidSignedActivityError("Only Turnkey submit endpoints can be forwarded");
      }

      let body: { type?: unknown; organizationId?: unknown };
      try {
        body = JSON.parse(request.body) as typeof body;
      } catch {
        throw new InvalidSignedActivityError("Signed body is not valid JSON");
      }
      if (typeof body.type !== "string" || !expectations.allowedActivityTypes.includes(body.type)) {
        throw new InvalidSignedActivityError("Activity type not allowed for this operation");
      }
      if (body.organizationId !== expectations.organizationId) {
        throw new InvalidSignedActivityError("Signed activity targets a different organization");
      }
      if (
        request.stamp.stampHeaderName.toLowerCase() !== "x-stamp-webauthn" &&
        request.stamp.stampHeaderName.toLowerCase() !== "x-stamp"
      ) {
        throw new InvalidSignedActivityError("Unsupported stamp header");
      }

      const response = await sendStampedRequest<{ activity?: TurnkeyActivity }>(request, config);
      let activity = response.activity;
      if (!activity) {
        throw new SigningServiceUnavailableError("Turnkey activity response was empty");
      }

      for (
        let attempt = 0;
        attempt < pollAttempts && !isTerminalActivity(activity.status);
        attempt++
      ) {
        await sleep(pollDelayMs);
        activity = await config.reader.getActivity(
          activity.organizationId ?? expectations.organizationId,
          activity.id,
        );
      }
      return activity;
    },
  };
}
