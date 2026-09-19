// Workers-compatible Turnkey access. Spike findings (workerd, 2026-09-16):
// - @turnkey/http TurnkeyClient requests fail on Workers: its fetch uses `redirect: "error"`.
// - Its `stamp*` methods work, and ApiKeyStamper signs correctly with every backend.
// So requests are built and signed with the official packages and sent with our own fetch.
// The stamper is pinned to WebCrypto so it does not depend on nodejs_compat detection.

import {
  SignedActivityRejectedError,
  SigningServiceUnavailableError,
  type SignedActivityRequest,
  type TurnkeyActivity,
  type TurnkeyReader,
} from "@pickler/core";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { TurnkeyClient } from "@turnkey/http";

export const TURNKEY_API_BASE_URL = "https://api.turnkey.com";

export interface TurnkeyTransportConfig {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Sends a stamped Turnkey request and maps failures to core signing errors. */
export async function sendStampedRequest<T>(
  request: SignedActivityRequest,
  config: TurnkeyTransportConfig = {},
): Promise<T> {
  const doFetch = config.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(request.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [request.stamp.stampHeaderName]: request.stamp.stampHeaderValue,
      },
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
    });
  } catch (cause) {
    throw new SigningServiceUnavailableError(undefined, { cause });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message: string | undefined;
    try {
      message = (JSON.parse(text) as { message?: string }).message;
    } catch {
      // Non-JSON error body.
    }
    // Turnkey error bodies are {code, message, details}; its message is shown to the user verbatim, as in Relayer.
    if (response.status >= 400 && response.status < 500) {
      throw new SignedActivityRejectedError(message ?? "Signing service rejected the activity");
    }
    throw new SigningServiceUnavailableError(
      message ? `Signing service error: ${message}` : undefined,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new SigningServiceUnavailableError("Signing service returned an invalid response", {
      cause,
    });
  }
}

export interface TurnkeyApiKeyConfig extends TurnkeyTransportConfig {
  apiPublicKey: string;
  apiPrivateKey: string;
}

/** Official client used only to build and stamp requests with a server API key. */
export function createTurnkeyStampingClient(config: TurnkeyApiKeyConfig): TurnkeyClient {
  return new TurnkeyClient(
    { baseUrl: config.baseUrl ?? TURNKEY_API_BASE_URL },
    new ApiKeyStamper({
      apiPublicKey: config.apiPublicKey,
      apiPrivateKey: config.apiPrivateKey,
      runtimeOverride: "browser",
    }),
  );
}

/**
 * Read-only access with the parent API key, scoped by organizationId.
 * Ported from Relayer TurnkeyClientProvider#getReadClientForIntegrator (commit bb6bb1226e92).
 * The parent key cannot mutate sub-orgs, so no write helpers are offered here.
 */
export function createTurnkeyReader(config: TurnkeyApiKeyConfig): TurnkeyReader {
  const client = createTurnkeyStampingClient(config);
  return {
    async getActivity(organizationId, activityId) {
      const signed = await client.stampGetActivity({ organizationId, activityId });
      const { activity } = await sendStampedRequest<{ activity?: TurnkeyActivity }>(signed, config);
      if (!activity) {
        throw new SigningServiceUnavailableError("Turnkey activity response was empty");
      }
      return activity;
    },
  };
}
