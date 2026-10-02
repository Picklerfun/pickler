import * as dto from "@pickler/api-schema";
import { z } from "zod";
import { operation } from "../openapi/operation";
// The HTTP surface of the passkey custody flow in @pickler/core. Replaces Relayer
// apps/api/src/kits/signing/passkeys/passkey.controller.ts (commit bb6bb1226e92).
// Behaviour changes:
// - The caller is a Supabase user, not an integrator, and everything the passkey is named after
//   comes from the verified token and the profile rather than from the request body. The
//   sub-organization is never named after an email.
// - Every field is validated here, before it reaches core: an attestation is three base64url
//   strings and a list of transports Turnkey has a name for. Relayer forwarded what it was given
//   and learned about malformed ones from Turnkey, after the person's biometric ceremony.
// - The register response omits the root user id, and confirm answers with the activity's id and
//   status rather than the whole Turnkey activity.
// - New: the agent wallet ceremony under /agents (docs/specs/studio-create-and-fund-v1.md §4.1).
//   Relayer had no equivalent; each step is prepare → passkey stamp in the browser → confirm.

import {
  isWalletAccountEmail,
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
  /** Supplies the passkey's name and the Turnkey root user's, where there is a profile. */
  profiles: ReturnType<typeof createProfileService>;
  /**
   * The domain of wallet accounts' synthetic auth emails (`WALLET_EMAIL_DOMAIN`), so `identity`
   * can tell one from a real address. Undefined where wallet sign-in is not configured, and then
   * no such account can exist.
   */
  walletEmailDomain?: string | undefined;
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

/** A Turnkey wallet id: letters, digits and hyphens, as core's policy writer requires. */
const WALLET_ID = /^[A-Za-z0-9-]{1,128}$/;

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

/** No body, or `{}`. Anything else is a caller passing something this route does not take. */
async function emptyBody(c: Context<AppEnv>): Promise<void> {
  const raw = await c.req.text();
  if (raw.trim() === "") {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("This request takes no body");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length > 0
  ) {
    throw badRequest("This request takes no body");
  }
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

/** The unsigned activity as the Turnkey stamper consumes it, exactly as add/prepare answers. */
function unsignedDto(unsigned: {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}) {
  return {
    url: unsigned.url,
    body: unsigned.body,
    timestampMs: unsigned.timestampMs,
    organizationId: unsigned.organizationId,
  };
}

/**
 * `userOnly` already refuses API keys inside core's authenticate, before it ever looks at one.
 * This is the second check anyway: these routes move custody of a wallet, the principal type is
 * a union of four kinds, and a future authenticate that resolves a service or agent principal
 * from a bearer token would otherwise reach them silently.
 *
 * The id is the one the token proves; nothing is taken from the body, which would let a caller
 * choose whose passkey they were registering. So is the email, the Supabase JWT's `email` claim,
 * which only `identity` reads.
 */
function person(c: Context<AppEnv>): { id: string; email: string | null } {
  const principal = c.get("principal");
  if (principal.kind !== "user") {
    throw new HttpError(401, "Bearer JWT required");
  }
  return { id: principal.id, email: principal.email ?? null };
}

/**
 * The token's email when it is one a person would recognise in their keychain, else null. A wallet
 * account's auth email is synthetic (`<namespace>-<digest>@WALLET_EMAIL_DOMAIN`, see
 * infrastructure's wallet-accounts.ts): an internal key, never a contact, and not something to
 * store in anyone's password manager.
 */
function keychainEmail(email: string | null, walletEmailDomain: string | undefined): string | null {
  return email && !isWalletAccountEmail(email, walletEmailDomain) ? email : null;
}

/**
 * The two names a first passkey is given, which are deliberately not the same value:
 *
 * - `passkey` is WebAuthn's `user.name` / `user.displayName`, stored inside the authenticator and
 *   synced to iCloud Keychain or Google Password Manager, uneditable afterwards by the person or by
 *   us. It is the profile's handle and display name where there is a profile. Signup creates the
 *   passkey before the handle, so there usually is none yet, and then it is the person's sign-in
 *   email — what they will recognise the keychain entry by. Never a wallet account's synthetic
 *   email (`keychainEmail`); with no usable email it is the opaque fallback below.
 * - `ownerLabel` is the Turnkey root user's `userName`, and the sub-organization's name. It is
 *   NEVER an email: email is kept out of Turnkey on purpose. The handle where there is a profile,
 *   the fallback otherwise.
 *
 * The fallback is an opaque fragment of the user id rather than a refusal. The id is random, so it
 * discloses nothing — it is merely unfriendly, which is the right way for a fallback to be bad.
 *
 * Nothing here is persisted with the challenge. `issueChallenge` uses only `passkey`, `register`
 * only `ownerLabel`, and each is derived again from the same profile when its route runs; the
 * WebAuthn name never reaches Turnkey (it is not in the attestation), so a profile made between the
 * two calls changes the Turnkey label to the handle and leaves nothing inconsistent.
 */
async function identity(
  services: SigningRouteServices,
  user: { id: string; email: string | null },
): Promise<{ passkey: DisplayIdentity; ownerLabel: string }> {
  const profile = await services.profiles.getProfile(user.id);
  if (profile) {
    return {
      passkey: { name: profile.handle, displayName: profile.displayName },
      ownerLabel: profile.handle,
    };
  }
  const fallback = `pickler-${user.id.slice(0, 8)}`;
  const email = keychainEmail(user.email, services.walletEmailDomain);
  return {
    passkey: email
      ? { name: email, displayName: email }
      : { name: fallback, displayName: fallback },
    ownerLabel: fallback,
  };
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
  api.post(
    "/passkeys/challenge",
    operation("signingChallenge", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(dto.passkeyChallengeSchema),
    }),
    async (c) => {
      const user = person(c);
      const custody = services.custody(c.get("requestId"));
      const options = await custody.issueChallenge(
        user.id,
        (await identity(services, user)).passkey,
      );
      return c.json(successEnvelope(options, c.req.path, "Challenge issued"));
    },
  );

  // 200 rather than 201: registering is idempotent, and half the time the account it answers
  // with is one an earlier request created.
  api.post(
    "/passkeys/register",
    operation("signingRegister", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(dto.custodyAccountSchema),
      body: dto.registerPasskeySchema,
    }),
    async (c) => {
      const user = person(c);
      const body = await jsonBody(c);
      const input = {
        ownerLabel: (await identity(services, user)).ownerLabel,
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
    },
  );

  // Answered as the Turnkey stamper consumes it, so the browser passes it straight through.
  api.post(
    "/passkeys/add/prepare",
    operation("signingAddPrepare", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(dto.unsignedActivitySchema),
      body: dto.registerPasskeySchema,
    }),
    async (c) => {
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
    },
  );

  api.post(
    "/passkeys/add/confirm",
    operation("signingAddConfirm", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(z.object({ activity_id: z.string(), status: z.string() })),
      body: z.object({
        label: z.string(),
        credential_id: z.string(),
        transports: z.array(z.string()),
        signed: dto.signedActivitySchema,
      }),
    }),
    async (c) => {
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
    },
  );

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
  api.get(
    "/passkeys",
    operation("signingPasskeys", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(dto.passkeySchema.array()),
    }),
    async (c) => {
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
    },
  );

  api.get(
    "/wallets/me",
    operation("signingMasterWallet", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(dto.walletBalanceSchema),
    }),
    async (c) => {
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
    },
  );

  // ─── The agent wallet ceremony ────────────────────────────────────────────────────────────
  // Three steps, each prepared here, stamped by the person's passkey and confirmed here: Pickler's
  // delegated user (first agent only), the agent's wallet ("Agent wallet N"), and that wallet's
  // policies, which wait until the wallet holds the minimums to start. The link to an agent is
  // written by the drafts route's transaction, not by these routes.

  /** Which steps the browser still has to run. */
  api.get(
    "/agents/state",
    operation("signingAgentState", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(
        z.object({ has_sub_organization: z.boolean(), has_delegated_user: z.boolean() }),
      ),
    }),
    async (c) => {
      const user = person(c);
      const state = await services.custody(c.get("requestId")).agentWalletState(user.id);
      return c.json(
        successEnvelope(
          {
            has_sub_organization: state.hasSubOrganization,
            has_delegated_user: state.hasDelegatedUser,
          },
          c.req.path,
          "Agent wallet state",
        ),
      );
    },
  );

  api.post(
    "/agents/delegated/prepare",
    operation("signingDelegatedPrepare", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(dto.unsignedActivitySchema),
    }),
    async (c) => {
      const user = person(c);
      const unsigned = await services.custody(c.get("requestId")).prepareDelegatedUser(user.id);
      return c.json(successEnvelope(unsignedDto(unsigned), c.req.path, "Activity prepared"));
    },
  );

  api.post(
    "/agents/delegated/confirm",
    operation("signingDelegatedConfirm", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(z.object({ delegated_user_id: z.string() })),
      body: z.object({ signed: dto.signedActivitySchema }),
    }),
    async (c) => {
      const user = person(c);
      const signed = signedActivity(await jsonBody(c));
      const saved = await services
        .custody(c.get("requestId"))
        .confirmDelegatedUser(user.id, signed);
      return c.json(
        successEnvelope(
          { delegated_user_id: saved.delegatedUserId },
          c.req.path,
          "Pickler has its seat",
        ),
      );
    },
  );

  // A new wallet is named "Agent wallet N", never after a handle: the wallet exists before the
  // agent does. The body must be empty or `{}`. A wallet already minted and never linked is
  // answered as `existing`, and the browser skips the stamp: a retry never leaves a second wallet
  // behind. `policies_approved` says its rules were approved too, so the browser skips that prompt
  // as well.
  api.post(
    "/agents/wallet/prepare",
    operation("signingWalletPrepare", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(
        z.union([
          dto.unsignedActivitySchema,
          z.object({
            existing: z.object({
              wallet_id: z.string(),
              address: z.string(),
              policies_approved: z.boolean(),
            }),
          }),
        ]),
      ),
      body: dto.emptyRequestSchema,
      optionalBody: true,
    }),
    async (c) => {
      const user = person(c);
      await emptyBody(c);
      const prepared = await services.custody(c.get("requestId")).prepareAgentWallet(user.id);
      if ("existing" in prepared) {
        return c.json(
          successEnvelope(
            {
              existing: {
                wallet_id: prepared.existing.walletId,
                address: prepared.existing.address,
                policies_approved: prepared.existing.policiesApproved,
              },
            },
            c.req.path,
            "Wallet already exists",
          ),
        );
      }
      return c.json(
        successEnvelope(unsignedDto(prepared.unsigned), c.req.path, "Activity prepared"),
      );
    },
  );

  api.post(
    "/agents/wallet/confirm",
    operation("signingWalletConfirm", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(z.object({ wallet_id: z.string(), address: z.string() })),
      body: z.object({ signed: dto.signedActivitySchema }),
    }),
    async (c) => {
      const user = person(c);
      const signed = signedActivity(await jsonBody(c));
      const wallet = await services.custody(c.get("requestId")).confirmAgentWallet(user.id, signed);
      return c.json(
        successEnvelope(
          { wallet_id: wallet.walletId, address: wallet.address },
          c.req.path,
          "Wallet created",
        ),
      );
    },
  );

  // Whether this is the person's first agent — and so whether Pickler's self-delete policy rides
  // along — is decided by core from what is linked, never by the caller. The body must be empty
  // or `{}`: a field here (the old `first_agent` included) is refused rather than ignored.
  api.post(
    "/agents/wallet/:walletId/policies/prepare",
    operation("signingPoliciesPrepare", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(dto.unsignedActivitySchema),
      body: dto.emptyRequestSchema,
      optionalBody: true,
    }),
    async (c) => {
      const user = person(c);
      const walletId = walletIdParam(c.req.param("walletId"));
      await emptyBody(c);
      const unsigned = await services
        .custody(c.get("requestId"))
        .preparePolicies(user.id, walletId);
      return c.json(successEnvelope(unsignedDto(unsigned), c.req.path, "Activity prepared"));
    },
  );

  api.post(
    "/agents/wallet/:walletId/policies/confirm",
    operation("signingPoliciesConfirm", {
      security: "user",
      errorStatuses: [400, 401, 403, 404, 409, 413, 500, 502, 503],
      response: dto.envelopeSchema(z.object({ policy_ids: z.array(z.string()) })),
      body: z.object({ signed: dto.signedActivitySchema }),
    }),
    async (c) => {
      const user = person(c);
      const walletId = walletIdParam(c.req.param("walletId"));
      const signed = signedActivity(await jsonBody(c));
      const confirmed = await services
        .custody(c.get("requestId"))
        .confirmPolicies(user.id, walletId, signed);
      return c.json(
        successEnvelope({ policy_ids: confirmed.policyIds }, c.req.path, "Policies approved"),
      );
    },
  );

  return api;
}

function walletIdParam(value: string): string {
  if (!WALLET_ID.test(value)) {
    throw badRequest("Invalid wallet id");
  }
  return value;
}
