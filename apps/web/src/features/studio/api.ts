"use client";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import type {
  agentConfigSchema,
  agentResponseSchema,
  studioOptionsSchema,
  runResponseSchema,
  eventResponseSchema,
  marketCatalogSchema,
  paperOrderSchema,
  studioAgentSchema,
  ActivityDto,
  DirectoryAgentDto,
  DraftCreateDto,
  IdentityUpdateDto,
  LedgerDto,
  LeaderboardDto,
  MarketDetailDto,
  PerpMarketDto,
  PublishDto,
  SetupUpdateDto,
  SignedActivityDto,
  TransferRequestDto,
  VersionsDto,
  WalletsDto,
  XChallengeDto,
  XChallengeRequestDto,
  XStateDto,
  XVerifyDto,
} from "@pickler/api-schema";
import { knownMessage, messageFor } from "./lib/messages";
export type Config = ReturnType<typeof agentConfigSchema.parse>;
/**
 * The studio agent DTO: the runtime record plus its product identity, its wallet and balance, both
 * locks and its spend limits. `GET /agents` and `GET /agents/:id` answer it.
 */
export type Agent = ReturnType<typeof studioAgentSchema.parse>;
/** The bare runtime record the writes answer (`PUT /config|limits|interval`). */
type AgentRecord = ReturnType<typeof agentResponseSchema.parse>;
export type Run = ReturnType<typeof runResponseSchema.parse>;
export type RunEvent = ReturnType<typeof eventResponseSchema.parse>;
export type Catalog = ReturnType<typeof marketCatalogSchema.parse>;
export type Options = ReturnType<typeof studioOptionsSchema.parse>;
export type PaperOrder = ReturnType<typeof paperOrderSchema.parse>;
export type { SignedActivityDto };
export type StudioWallets = WalletsDto;
export type ActivityEvent = ActivityDto["events"][number];
/** One saved setup: its config version, the server's line for what changed, and when. */
export type SetupVersion = VersionsDto["versions"][number];
export type LedgerEntry = LedgerDto["entries"][number];
export type XState = XStateDto;
export type XChallenge = XChallengeDto;
export type XVerify = XVerifyDto;

/**
 * The studio transport answers a failure with `{ error: CODE }`. The code is what the Studio
 * branches on — it decides which blocked state to show and which control to lock — so it travels
 * with the error instead of being flattened into prose.
 */
export class StudioError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** The server's own words, when it sent any; `message` is the studio's for the code. */
    public readonly serverMessage?: string,
    /** The rest of the error body: `field`/`reason` for INVALID_BRIEF, `retryAt` for a limit. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StudioError";
  }
}
export const errorCode = (caught: unknown): string =>
  caught instanceof StudioError ? caught.code : "";

export async function studioApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Authentication is not configured.");
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new StudioError("UNAUTHORIZED", messageFor("UNAUTHORIZED", undefined));
  }
  const response = await fetch(`/api/v1/studio${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    const code = typeof body?.error === "string" ? body.error : String(response.status);
    const serverMessage = typeof body?.message === "string" ? body.message : undefined;
    throw new StudioError(
      code,
      messageFor(code, serverMessage),
      serverMessage,
      body && typeof body === "object" ? (body as Record<string, unknown>) : undefined,
    );
  }
  return body as T;
}

// ─── Creating, running ─────────────────────────────────────────────────────────────────────────

/**
 * `POST /drafts`: "Create {Name}" on a funded, policy-signed wallet. 409 WALLET_UNDERFUNDED,
 * WALLET_ASSIGNED, POLICIES_MISSING, HANDLE_TAKEN; 404 WALLET_NOT_FOUND; 503 WALLETS_UNAVAILABLE.
 */
export const createDraft = (body: DraftCreateDto) =>
  studioApi<{ productId: string; agent: AgentRecord }>("/drafts", {
    method: "POST",
    body: JSON.stringify(body),
  });

/** `GET /agents/:id`: one agent with its wallet, balance and locks, read fresh. */
export const studioAgent = (agentId: string) => studioApi<Agent>(`/agents/${agentId}`);

/** `GET /agents/:id/runs`: newest first. */
export const agentRuns = (agentId: string, signal?: AbortSignal) =>
  studioApi<{ runs: Run[] }>(`/agents/${agentId}/runs`, signal ? { signal } : {});

export const runEvents = (runId: string, signal?: AbortSignal) =>
  studioApi<{ events: RunEvent[] }>(`/runs/${runId}/events`, signal ? { signal } : {});

export const run = (runId: string) => studioApi<Run>(`/runs/${runId}`);

/** `GET /runs/:id/paper-order`: the order a TRADE was tracked with, or 404 NOT_FOUND. */
export const readPaperOrder = (runId: string) =>
  studioApi<PaperOrder>(`/runs/${runId}/paper-order`);

/**
 * `PUT /agents/:id/interval { hours: 3 | 6 | 12 | 24 }`: only `config.intervalHours`, keeping the
 * version, the schedule and readiness, so it can be tuned right before the schedule is turned on.
 */
export const setIntervalHours = (agentId: string, hours: 3 | 6 | 12 | 24) =>
  studioApi<AgentRecord>(`/agents/${agentId}/interval`, {
    method: "PUT",
    body: JSON.stringify({ hours }),
  });

export const saveLimits = (agentId: string, perCallAusd: number, perDayAusd: number) =>
  studioApi<AgentRecord>(`/agents/${agentId}/limits`, {
    method: "PUT",
    body: JSON.stringify({ perCallAusd, perDayAusd }),
  });

export const setSchedule = (agentId: string, enabled: boolean) =>
  studioApi<{ ok: true }>(`/agents/${agentId}/schedule`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });

// ─── The draft's studio (studio-draft-dashboard-v1 §4) ──────────────────────────────────────────

/**
 * `PUT /agents/:id/setup`: a Perpl agent's brief, sources, caps, voice and entry, draft or public,
 * at `expectedVersion`. Answers the studio agent. 400 INVALID_BRIEF (with `field`, `reason`) /
 * INVALID_INPUT; 409 CONFLICT (the config moved on: reload), NOT_A_PERPL_AGENT.
 */
export const saveDraftSetup = (agentId: string, body: SetupUpdateDto) =>
  studioApi<Agent>(`/agents/${agentId}/setup`, { method: "PUT", body: JSON.stringify(body) });

/** `PUT /agents/:id/identity`: name and avatar; the handle is fixed. 400 INVALID_INPUT. */
export const saveIdentity = (agentId: string, body: IdentityUpdateDto) =>
  studioApi<Agent>(`/agents/${agentId}/identity`, { method: "PUT", body: JSON.stringify(body) });

/** `GET /agents/:id/activity`: created, its wallet, each transfer; newest first, at most 50. */
export const agentActivity = (agentId: string, signal?: AbortSignal) =>
  studioApi<ActivityDto>(`/agents/${agentId}/activity`, signal ? { signal } : {});

/**
 * `GET /agents/:id/versions`: the saved setups the server recorded, newest first, at most 20. The
 * owner's alone (403 for a member); 404 NOT_FOUND for an agent that is not the caller's.
 */
export const agentVersions = (agentId: string, signal?: AbortSignal) =>
  studioApi<VersionsDto>(`/agents/${agentId}/versions`, signal ? { signal } : {});

/**
 * `PUT /agents/:id/pause { paused }`: "Pause entries" / "Resume" (studio-live-v1 L4). Pausing
 * refuses new paper opens; exits are untouched.
 */
export const setPaused = (agentId: string, paused: boolean) =>
  studioApi<{ ok: true }>(`/agents/${agentId}/pause`, {
    method: "PUT",
    body: JSON.stringify({ paused }),
  });

/** `GET /agents/:id/x`: the verified account, the live challenge, and whether X is open yet. */
export const xState = (agentId: string, signal?: AbortSignal) =>
  studioApi<XState>(`/agents/${agentId}/x`, signal ? { signal } : {});

/**
 * `POST /agents/:id/x/challenge`: the line to post from `handle` ("@" optional). 400
 * INVALID_X_HANDLE; 409 X_HANDLE_TAKEN, X_ALREADY_CONNECTED; 503 X_UNAVAILABLE.
 */
export const xChallenge = (agentId: string, handle: string) =>
  studioApi<XChallenge>(`/agents/${agentId}/x/challenge`, {
    method: "POST",
    body: JSON.stringify({ handle } satisfies XChallengeRequestDto),
  });

/**
 * `POST /agents/:id/x/verify` ("Check again"). 404 CHALLENGE_NOT_FOUND; 409 CHALLENGE_EXPIRED,
 * X_HANDLE_TAKEN; 429 TOO_MANY_CHECKS (one per 10 s); 503 X_UNAVAILABLE.
 */
export const xVerify = (agentId: string) =>
  studioApi<XVerify>(`/agents/${agentId}/x/verify`, { method: "POST", body: "{}" });

/** `DELETE /agents/:id/x`: while private only; 409 X_ON_PUBLIC_AGENT. */
export const xDisconnect = (agentId: string) =>
  studioApi<{ disconnected: true }>(`/agents/${agentId}/x`, { method: "DELETE" });

/**
 * `POST /agents/:id/publish`: Go Public; idempotent. 409 PUBLISH_BLOCKED with
 * `details.detail.blockers` (WALLET, FUNDS, KILLED), PUBLISH_CONFLICT (try again); 503
 * BALANCES_UNAVAILABLE.
 */
export const publishAgent = (agentId: string) =>
  studioApi<PublishDto>(`/agents/${agentId}/publish`, { method: "POST", body: "{}" });

/** `GET /wallets/ledger`: the person's transfers, newest first, at most 100. */
export const walletLedger = (signal?: AbortSignal) =>
  studioApi<LedgerDto>("/wallets/ledger", signal ? { signal } : {});

interface DepositPrepared {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
  amountMicroUsd: number;
}

export const depositPrepare = (agentId: string, amountAusd: number) =>
  studioApi<DepositPrepared>(`/agents/${agentId}/deposit/prepare`, {
    method: "POST",
    body: JSON.stringify({ amountAusd }),
  });

export const depositConfirm = (agentId: string, amountAusd: number, signed: SignedActivityDto) =>
  studioApi<{ txHash: string }>(`/agents/${agentId}/deposit/confirm`, {
    method: "POST",
    body: JSON.stringify({ amountAusd, signed }),
  });

// ─── The passkey ceremony (`/v1/signing`) and public handle lookup ─────────────────────────────
//
// These routes answer Relayer's envelope (`{ success, message, data, ... }`), unlike the studio
// routes above, which answer plain JSON. `envelopeApi` unwraps it and turns a failed or `success:
// false` answer into the same `StudioError` `studioApi` throws, so a caller branches on `errorCode`
// the same way regardless of which family a request belongs to.

interface Envelope<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

async function envelopeApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = getSupabase();
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (session) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const response = await fetch(`/api${path}`, { ...init, cache: "no-store", headers });
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !body?.success) {
    const code = body?.error ?? String(response.status);
    const serverMessage = typeof body?.message === "string" ? body.message : undefined;
    throw new StudioError(
      code,
      knownMessage(code) ?? serverMessage ?? "Request failed",
      serverMessage,
      body ? (body as unknown as Record<string, unknown>) : undefined,
    );
  }
  return body.data as T;
}

interface UnsignedActivityDto {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}

export const agentState = () =>
  envelopeApi<{ has_sub_organization: boolean; has_delegated_user: boolean }>(
    "/v1/signing/agents/state",
  ).then((data) => ({
    hasSubOrganization: data.has_sub_organization,
    hasDelegatedUser: data.has_delegated_user,
  }));

export const prepareDelegated = () =>
  envelopeApi<UnsignedActivityDto>("/v1/signing/agents/delegated/prepare", { method: "POST" });

export const confirmDelegated = (signed: SignedActivityDto) =>
  envelopeApi<{ delegated_user_id: string }>("/v1/signing/agents/delegated/confirm", {
    method: "POST",
    body: JSON.stringify({ signed }),
  }).then((data) => ({ delegatedUserId: data.delegated_user_id }));

type PrepareWalletResult =
  | { existing: { walletId: string; address: string; policiesApproved: boolean } }
  | UnsignedActivityDto;

/** An unlinked wallet an earlier attempt left comes back as `existing`, with its rules' state. */
export const prepareWallet = () =>
  envelopeApi<
    | { existing: { wallet_id: string; address: string; policies_approved: boolean } }
    | UnsignedActivityDto
  >("/v1/signing/agents/wallet/prepare", {
    method: "POST",
    body: "{}",
  }).then((data): PrepareWalletResult =>
    "existing" in data
      ? {
          existing: {
            walletId: data.existing.wallet_id,
            address: data.existing.address,
            policiesApproved: data.existing.policies_approved === true,
          },
        }
      : data,
  );

export const confirmWallet = (signed: SignedActivityDto) =>
  envelopeApi<{ wallet_id: string; address: string }>("/v1/signing/agents/wallet/confirm", {
    method: "POST",
    body: JSON.stringify({ signed }),
  }).then((data) => ({ walletId: data.wallet_id, address: data.address }));

export const preparePolicies = (walletId: string) =>
  envelopeApi<UnsignedActivityDto>(
    `/v1/signing/agents/wallet/${encodeURIComponent(walletId)}/policies/prepare`,
    { method: "POST" },
  );

export const confirmPolicies = (walletId: string, signed: SignedActivityDto) =>
  envelopeApi<{ policy_ids: string[] }>(
    `/v1/signing/agents/wallet/${encodeURIComponent(walletId)}/policies/confirm`,
    { method: "POST", body: JSON.stringify({ signed }) },
  ).then((data) => ({ policyIds: data.policy_ids }));

interface HandleAvailability {
  handle: string;
  available: boolean;
  reason?: "too_short" | "too_long" | "invalid_characters" | "reserved" | "taken";
}

/** `GET /v1/handles/:handle/availability`: public, and shared with the account handle check. */
export const handleAvailable = (handle: string) =>
  envelopeApi<HandleAvailability>(`/v1/handles/${encodeURIComponent(handle)}/availability`);

// ─── Wallets and transfers (`/v1/studio/wallets`) ──────────────────────────────────────────

/** `GET /wallets`: the master wallet and the person's agent wallets with their balances. */
export const studioWallets = () => studioApi<StudioWallets>("/wallets");

/** What a transfer prepare answers: the unsigned activity and the amount in base units. */
export type TransferPlan = UnsignedActivityDto & { baseUnits: string };

/**
 * `POST /wallets/transfers/prepare`. 400 INVALID_TRANSFER; 404 WALLET_NOT_FOUND; 409
 * INSUFFICIENT_FUNDS, INSUFFICIENT_GAS, NOT_SENDABLE; 503 WALLETS_UNAVAILABLE.
 */
export const transferPrepare = (body: TransferRequestDto) =>
  studioApi<TransferPlan>("/wallets/transfers/prepare", {
    method: "POST",
    body: JSON.stringify(body),
  });

/**
 * `POST /wallets/transfers/confirm`: the same body and the passkey's stamp. 400 FEE_TOO_HIGH,
 * NONCE_GAP (prepare again); 409 TRANSFER_ALREADY_RECORDED; 500 SIGNED_TX_MISMATCH (not sent).
 */
export const transferConfirm = (body: TransferRequestDto, signed: SignedActivityDto) =>
  studioApi<{ txHash: string }>("/wallets/transfers/confirm", {
    method: "POST",
    body: JSON.stringify({ ...body, signed }),
  });

// ─── The marketplace's public reads (`/v1/marketplace`), for the live studio ───────────────────────
//
// Public and unauthenticated, plain JSON like the studio routes. The server-side facade
// (`server/container.ts`) is server-only, so the browser reads them here, through the same-origin
// transport. A failure throws `StudioError` with the status as its code.

async function marketplaceApi<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/marketplace${path}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const code = String(response.status);
    throw new StudioError(code, messageFor(code, undefined));
  }
  return (await response.json()) as T;
}

/** `GET /marketplace/markets`: Perpl's board (or the labelled sample board); 503 when unread. */
export const marketplaceMarkets = (signal?: AbortSignal) =>
  marketplaceApi<PerpMarketDto[]>("/markets", signal);

/** `GET /marketplace/markets/:symbol` ("BTC-PERP"): the market with its 24 h trail, or null. */
export const marketplaceMarket = (symbol: string, signal?: AbortSignal) =>
  marketplaceApi<MarketDetailDto | null>(`/markets/${encodeURIComponent(symbol)}`, signal);

/** `GET /marketplace/directory`: every public agent, in the directory's order. */
export const marketplaceDirectory = (signal?: AbortSignal) =>
  marketplaceApi<DirectoryAgentDto[]>("/directory", signal);

/** `GET /marketplace/leaderboard`: ranked by score, with the weights that make it. */
export const marketplaceLeaderboard = (signal?: AbortSignal) =>
  marketplaceApi<LeaderboardDto>("/leaderboard", signal);

// ─── The Perpl paper runtime (perpl-paper-runtime-v1 §4) ────────────────────────────────────────
// Shared by both studios: the draft Console runs manual checks with these, and the live studio
// reads the same routes. Its DTO types are named in this block rather than in the import list.

type PerpsSchema = typeof import("@pickler/api-schema");
export type PerpsChecksDto = ReturnType<PerpsSchema["perpsChecksResponseSchema"]["parse"]>;
export type PerpsCheckSummaryDto = import("@pickler/api-schema").PerpsCheckSummaryDto;
export type PerpsCheckDetailDto = import("@pickler/api-schema").PerpsCheckDetailDto;
export type PerpsPositionsResponseDto = import("@pickler/api-schema").PerpsPositionsResponseDto;
export type PerpsRecordDto = import("@pickler/api-schema").PerpsRecordDto;

/**
 * `POST /agents/:id/perps/checks` ("Run it on paper"): queues a manual check, 202 `{ checkId }`.
 * `key` is the Idempotency-Key, one per press, so a retried request is the same check. 409
 * NOT_A_PERPL_AGENT, RUNTIME_DISABLED, CHECK_RUNNING, AGENT_KILLED; 429 MANUAL_LIMIT (6 a UTC day).
 */
export const startPerpsCheck = (agentId: string, key: string) =>
  studioApi<{ checkId: string }>(`/agents/${agentId}/perps/checks`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: "{}",
  });

/** `GET /agents/:id/perps/checks`: the Decisions feed, newest first, 50 a page. */
export const perpsChecks = (agentId: string, signal?: AbortSignal) =>
  studioApi<PerpsChecksDto>(`/agents/${agentId}/perps/checks`, signal ? { signal } : {});

/** `GET /perps/checks/:id`: one check with its timed steps, polled while it runs. */
export const perpsCheck = (checkId: string, signal?: AbortSignal) =>
  studioApi<PerpsCheckDetailDto>(`/perps/checks/${checkId}`, signal ? { signal } : {});

/** `GET /agents/:id/perps/positions`: open paper positions marked to the board, and closed ones. */
export const perpsPositions = (agentId: string, signal?: AbortSignal) =>
  studioApi<PerpsPositionsResponseDto>(
    `/agents/${agentId}/perps/positions`,
    signal ? { signal } : {},
  );

/** `GET /agents/:id/perps/record`: the record, `runtimeEnabled` and today's figures. */
export const perpsRecord = (agentId: string, signal?: AbortSignal) =>
  studioApi<PerpsRecordDto>(`/agents/${agentId}/perps/record`, signal ? { signal } : {});

// ─── The Perpl paper runtime: the live studio's own calls (perpl-paper-runtime-v1 §4) ───────────
// The live studio reads the record, the checks, the positions and the proposals above, and adds an
// older page of the feed, the proposals and the owner's paper actions here. An approve, a close or
// a stop writes a durable owner action and answers 202 `{ actionId }`; the research worker carries
// it out, and the studio polls `GET /perps/actions/:id` until it is `done` or `failed`. Each takes
// the press's Idempotency-Key, so a retry after an answer that never came is the same action.

export type PerpsProposalDto = import("@pickler/api-schema").PerpsProposalDto;
export type PerpsActionStartedDto = import("@pickler/api-schema").PerpsActionStartedDto;
export type PerpsActionDto = import("@pickler/api-schema").PerpsActionDto;

/** `GET /agents/:id/perps/checks?before=`: the feed's next page, older than `before`. */
export const perpsChecksBefore = (agentId: string, before: string, signal?: AbortSignal) =>
  studioApi<PerpsChecksDto>(
    `/agents/${agentId}/perps/checks?before=${encodeURIComponent(before)}`,
    signal ? { signal } : {},
  );

/** `GET /agents/:id/perps/proposals`: the pending approve-mode proposals ("Waiting on you"). */
export const perpsProposals = (agentId: string, signal?: AbortSignal) =>
  studioApi<{ proposals: PerpsProposalDto[] }>(
    `/agents/${agentId}/perps/proposals`,
    signal ? { signal } : {},
  );

/** An owner action's POST: no body, the press's Idempotency-Key. */
const ownerAction = (path: string, key: string) =>
  studioApi<PerpsActionStartedDto>(path, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: "{}",
  });

/**
 * `POST /perps/proposals/:id/approve` ("Enter" / "Size up"): 202 `{ actionId }`. 409
 * PROPOSAL_DECIDED, PROPOSAL_EXPIRED, RUNTIME_DISABLED, AGENT_KILLED.
 */
export const approvePerpsProposal = (proposalId: string, key: string) =>
  ownerAction(`/perps/proposals/${proposalId}/approve`, key);

/** `POST /perps/proposals/:id/skip` ("Skip" / "Keep it small"): decided at once. 409 as approve. */
export const skipPerpsProposal = (proposalId: string) =>
  studioApi<{ id: string; status: "approved" | "skipped" | "expired" }>(
    `/perps/proposals/${proposalId}/skip`,
    { method: "POST", body: "{}" },
  );

/** `POST /perps/positions/:id/close` ("Close now", paper): 202 `{ actionId }`. 409 POSITION_CLOSED. */
export const closePerpsPosition = (positionId: string, key: string) =>
  ownerAction(`/perps/positions/${encodeURIComponent(positionId)}/close`, key);

/** `POST /agents/:id/perps/stop` ("Stop · close all", paper): pauses at once, 202 `{ actionId }`. */
export const stopPerps = (agentId: string, key: string) =>
  ownerAction(`/agents/${agentId}/perps/stop`, key);

/**
 * `GET /perps/actions/:id`: `pending` (waiting for the worker, or for a running check to free the
 * agent: `lastError` CHECK_RUNNING), `running`, `done` (its `checkId` says what happened) or
 * `failed` (`lastError`).
 */
export const perpsAction = (actionId: string, signal?: AbortSignal) =>
  studioApi<PerpsActionDto>(`/perps/actions/${actionId}`, signal ? { signal } : {});
