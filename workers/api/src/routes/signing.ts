// The HTTP surface of the passkey custody flow in @pickler/core. Replaces Relayer
// apps/api/src/kits/signing/passkeys/passkey.controller.ts (commit bb6bb1226e92).
// Behaviour changes:
// - The caller is a Supabase user, not an integrator, and the email the sub-organization is
//   named after comes from the verified token rather than from the request body.
// - Every field is validated here, before it reaches core: an attestation is three base64url
//   strings and a list of transports Turnkey has a name for. Relayer forwarded what it was given
//   and learned about malformed ones from Turnkey, after the person's biometric ceremony.
// - The register response omits the root user id, and confirm answers with the activity's id and
//   status rather than the whole Turnkey activity.

import {
  SUPPORTED_TRANSPORTS,
  type createCustodyService,
  type PasskeyAttestation,
  type createProfileService,
  type DisplayIdentity,
} from "@pickler/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { successEnvelope } from "../http/envelope";
import { badRequest, HttpError, notFound } from "../http/http-error";
import { authenticated, type Authenticate } from "../middleware/auth";

/** What `createBalanceReader` offers, stated here so the HTTP layer names no adapter. */
export interface BalanceReader {
  read(address: string): Promise<{
    native: { symbol: string; decimals: number; raw: string | null };
    token: { symbol: string; decimals: number; raw: string | null };
  }>;
}

export interface SigningRouteServices {
  authenticate: Authenticate;
  /** Supplies the passkey's display name, which must never come from the auth email. */
  profiles: ReturnType<typeof createProfileService>;
  /**
   * Built per request, so the orphaned-sub-organization report a lost registration race produces
   * can name the request that caused it. Everything expensive is composed once behind this.
   */
  custody(requestId: string): ReturnType<typeof createCustodyService>;
  balances: BalanceReader;
}

/**
 * A passkey ceremony's largest field is the attestation object, a few hundred bytes for the
 * `attestation: "none"` this flow asks for. The caps are generous multiples of that: large
 * enough that no real device is refused, small enough that none of this is a place to post
 * megabytes at a database.
 */
const MAX = {
  label: 128,
  challenge: 128,
  credentialId: 512,
  clientDataJson: 4096,
  attestationObject: 8192,
  url: 512,
  body: 8192,
  stamp: 8192,
  transports: 8,
};

/** base64url with optional padding. Rejects the `+` and `/` of standard base64, and whitespace. */
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

type Body = Record<string, unknown>;

async function jsonBody(c: Context<AppEnv>): Promise<Body> {
  const parsed: unknown = await c.req.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("A JSON object body is required");
  }
  return parsed as Body;
}

function text(body: Body, field: string, max: number): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw badRequest(`Field '${field}' must be a string of 1 to ${max} characters`);
  }
  return value;
}

function base64url(body: Body, field: string, max: number): string {
  const value = text(body, field, max);
  if (!BASE64URL.test(value)) {
    throw badRequest(`Field '${field}' must be base64url`);
  }
  return value;
}

function object(body: Body, field: string): Body {
  const value = body[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`Field '${field}' must be an object`);
  }
  return value as Body;
}

/**
 * An empty list is allowed and means "unstated": `toTurnkeyTransports` reads it as an internal
 * authenticator, which is what a browser that reports nothing almost always is. A word Turnkey
 * has no name for is refused here rather than at Turnkey, which would only say so after the
 * person had completed the ceremony and the challenge had been spent.
 */
function transports(body: Body, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length > MAX.transports) {
    throw badRequest(`Field '${field}' must be an array of at most ${MAX.transports} transports`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || !(SUPPORTED_TRANSPORTS as readonly string[]).includes(entry)) {
      throw badRequest(`Field '${field}' must contain only ${SUPPORTED_TRANSPORTS.join(", ")}`);
    }
  }
  return value as string[];
}

function attestation(body: Body): PasskeyAttestation {
  const raw = object(body, "attestation");
  return {
    credentialId: base64url(raw, "credentialId", MAX.credentialId),
    clientDataJson: base64url(raw, "clientDataJson", MAX.clientDataJson),
    attestationObject: base64url(raw, "attestationObject", MAX.attestationObject),
    transports: transports(raw, "transports"),
  };
}

/** The request the browser stamped, in the shape Turnkey's own stamper produces. */
function signedActivity(body: Body) {
  const raw = object(body, "signed");
  const stamp = object(raw, "stamp");
  return {
    url: text(raw, "url", MAX.url),
    body: text(raw, "body", MAX.body),
    stamp: {
      stampHeaderName: text(stamp, "stampHeaderName", 64),
      stampHeaderValue: text(stamp, "stampHeaderValue", MAX.stamp),
    },
  };
}

/**
 * `userOnly` already refuses API keys inside core's authenticate, before it ever looks at one.
 * This is the second check anyway: these routes move custody of a wallet, the principal type is
 * a union of four kinds, and a future authenticate that resolves a service or agent principal
 * from a bearer token would otherwise reach them silently.
 *
 * The id is the one the token proves; nothing is taken from the body, which would let a caller
 * choose whose passkey they were registering.
 */
function person(c: Context<AppEnv>): { id: string } {
  const principal = c.get("principal");
  if (principal.kind !== "user") {
    throw new HttpError(401, "Bearer JWT required");
  }
  return { id: principal.id };
}

/**
 * What the passkey will be called, in the operating system's credential picker and in Turnkey's
 * dashboard. It comes from the profile, and never from `principal.email`.
 *
 * The auth email cannot be used here. For a wallet account it is synthetic and derived from the
 * wallet, and WebAuthn's `user.name` is stored inside the authenticator and synced to iCloud
 * Keychain or Google Password Manager — so labelling a credential with it would put a wallet
 * address in someone's password manager permanently, uneditable by them or by us. That is on the
 * ordinary "trade first, build an agent later" path, not a corner of it.
 *
 * It is deliberately not given the request context: with no access to the principal there is no
 * email in reach, so the leak cannot be reintroduced by someone reaching for the nearest value.
 *
 * Someone with no profile is labelled by an opaque fragment of their user id rather than refused.
 * Requiring a profile would be defensible for wallet accounts but would newly lock out existing
 * email accounts that never made one, and a passkey is not the place to discover that. The id is
 * random, so the fallback discloses nothing — it is merely unfriendly, which is the right way for
 * a fallback to be bad.
 */
async function identity(services: SigningRouteServices, userId: string): Promise<DisplayIdentity> {
  const profile = await services.profiles.getProfile(userId);
  if (profile) {
    return { name: profile.handle, displayName: profile.displayName };
  }
  const fallback = `pickler-${userId.slice(0, 8)}`;
  return { name: fallback, displayName: fallback };
}

export function signingRoutes(services: SigningRouteServices) {
  const api = new Hono<AppEnv>();
  api.use("*", bodyLimit({ maxSize: 16_384 }));
  api.use("*", authenticated(services.authenticate, { userOnly: true }));
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });

  // The options go to navigator.credentials.create() as they are; this is the WebAuthn shape,
  // not an envelope of our own invention.
  api.post("/passkeys/challenge", async (c) => {
    const user = person(c);
    const custody = services.custody(c.get("requestId"));
    const options = await custody.issueChallenge(user.id, await identity(services, user.id));
    return c.json(successEnvelope(options, c.req.path, "Challenge issued"));
  });

  // 200 rather than 201: registering is idempotent, and half the time the account it answers
  // with is one an earlier request created.
  api.post("/passkeys/register", async (c) => {
    const user = person(c);
    const body = await jsonBody(c);
    const input = {
      identity: await identity(services, user.id),
      label: text(body, "label", MAX.label),
      challenge: base64url(body, "challenge", MAX.challenge),
      attestation: attestation(body),
    };
    const account = await services.custody(c.get("requestId")).register(user.id, input);
    return c.json(
      successEnvelope(
        {
          sub_organization_id: account.subOrganizationId,
          master_wallet_id: account.masterWalletId,
          address: account.address,
          // Deliberately not account.rootUserId: the browser never needs it, and it is the
          // parameter of the activity that adds a device to this person's wallet.
        },
        c.req.path,
        "Wallet ready",
      ),
    );
  });

  // Answered as the Turnkey stamper consumes it, so the browser passes it straight through.
  api.post("/passkeys/add/prepare", async (c) => {
    const user = person(c);
    const body = await jsonBody(c);
    const input = {
      label: text(body, "label", MAX.label),
      challenge: base64url(body, "challenge", MAX.challenge),
      attestation: attestation(body),
    };
    const unsigned = await services.custody(c.get("requestId")).prepareAddPasskey(user.id, input);
    return c.json(
      successEnvelope(
        {
          url: unsigned.url,
          body: unsigned.body,
          timestampMs: unsigned.timestampMs,
          organizationId: unsigned.organizationId,
        },
        c.req.path,
        "Activity prepared",
      ),
    );
  });

  api.post("/passkeys/add/confirm", async (c) => {
    const user = person(c);
    const body = await jsonBody(c);
    const input = {
      label: text(body, "label", MAX.label),
      credentialId: base64url(body, "credential_id", MAX.credentialId),
      transports: transports(body, "transports"),
      signed: signedActivity(body),
    };
    const activity = await services.custody(c.get("requestId")).confirmAddPasskey(user.id, input);
    // The id and the status, not the activity: it also carries the organisation, the votes and
    // a result whose shape changes per intent.
    return c.json(
      successEnvelope(
        { activity_id: activity.id, status: activity.status },
        c.req.path,
        "Device added",
      ),
    );
  });

  /**
   * This person's passkeys, oldest first, and nothing about anyone else's: the user id comes from
   * the verified token rather than the path, so there is no identifier here to tamper with.
   *
   * Nothing is caught. A failed read must reach the browser as a failure, because the screen that
   * calls this decides whether to tell somebody they can still reach their funds after losing a
   * device — and an empty list would read as "no passkeys", which is the more alarming of the two
   * ways to be wrong. `listPasskeys` in core carries the same note, and the pair exists precisely
   * so that `excludeCredentials`'s deliberate swallow cannot leak into this answer.
   *
   * `device_type` and `last_used_at` go out null when they are null. A passkey that has never
   * signed anything has no last-used date, and saying so is the point of the column.
   */
  api.get("/passkeys", async (c) => {
    const user = person(c);
    const passkeys = await services.custody(c.get("requestId")).listPasskeys(user.id);
    return c.json(
      successEnvelope(
        passkeys.map((passkey) => ({
          id: passkey.id,
          credential_id: passkey.credentialId,
          label: passkey.label,
          transports: passkey.transports,
          device_type: passkey.deviceType,
          created_at: passkey.createdAt.toISOString(),
          last_used_at: passkey.lastUsedAt === null ? null : passkey.lastUsedAt.toISOString(),
        })),
        c.req.path,
        "Passkeys retrieved",
      ),
    );
  });

  api.get("/wallets/me", async (c) => {
    const user = person(c);
    const account = await services.custody(c.get("requestId")).getAccount(user.id);
    if (!account) {
      throw notFound("Wallet");
    }
    // A balance that could not be read comes back null rather than zero; the reader decides.
    const balances = await services.balances.read(account.address);
    return c.json(
      successEnvelope({ address: account.address, balances }, c.req.path, "Wallet retrieved"),
    );
  });

  return api;
}
