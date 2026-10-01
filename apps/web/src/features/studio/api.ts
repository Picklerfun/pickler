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
  createAgentSchema,
  studioAgentSchema,
  AgentDraftDto,
  DraftCreateDto,
  SignedActivityDto,
  TransferRequestDto,
  WalletsDto,
  PreviewRunDto,
  PreviewRunRequestDto,
} from "@pickler/api-schema";
import { knownMessage, messageFor } from "./lib/messages";
export type Config = ReturnType<typeof agentConfigSchema.parse>;
export { DEFAULT_PROFILE, type Profile } from "./profile";
/**
 * The studio agent DTO: the runtime record plus its product identity, its wallet and balance, both
 * locks and its spend limits. `GET /agents` and `GET /agents/:id` answer it.
 */
export type Agent = ReturnType<typeof studioAgentSchema.parse>;
/** The bare runtime record the writes answer (`POST /agents`, `PUT /config|limits|interval`). */
type AgentRecord = ReturnType<typeof agentResponseSchema.parse>;
export type Run = ReturnType<typeof runResponseSchema.parse>;
export type RunEvent = ReturnType<typeof eventResponseSchema.parse>;
export type Catalog = ReturnType<typeof marketCatalogSchema.parse>;
export type Options = ReturnType<typeof studioOptionsSchema.parse>;
export type PaperOrder = ReturnType<typeof paperOrderSchema.parse>;
type CreateAgentInput = ReturnType<typeof createAgentSchema.parse>;
export type { AgentDraftDto, SignedActivityDto };
export type StudioWallets = WalletsDto;
/** A paper run of a brief, as its owner reads it. */
export type PreviewRun = PreviewRunDto["run"];

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

// ─── Drafting, creating, running ────────────────────────────────────────────────────────────

/** `POST /v1/studio/agents/draft`: one line becomes a proposed draft, or the model is unavailable. */
export const draftAgent = (line: string) =>
  studioApi<{ draft: AgentDraftDto; unsupported: string[] }>("/agents/draft", {
    method: "POST",
    body: JSON.stringify({ line }),
  });

/** `POST /preview-runs`: "Run it on paper". 400 INVALID_BRIEF names the section; 429 has `retryAt`. */
export const startPreviewRun = (body: PreviewRunRequestDto) =>
  studioApi<{ id: string }>("/preview-runs", { method: "POST", body: JSON.stringify(body) });

/** `GET /preview-runs/:id`: the run and its trace, in a run's event shape. */
export const readPreviewRun = (id: string, signal?: AbortSignal) =>
  studioApi<PreviewRunDto>(`/preview-runs/${encodeURIComponent(id)}`, signal ? { signal } : {});

/**
 * `POST /drafts`: "Create {Name}" on a funded, policy-signed wallet. 409 WALLET_UNDERFUNDED,
 * WALLET_ASSIGNED, POLICIES_MISSING, HANDLE_TAKEN; 404 WALLET_NOT_FOUND; 503 WALLETS_UNAVAILABLE.
 */
export const createDraft = (body: DraftCreateDto) =>
  studioApi<{ productId: string; agent: AgentRecord }>("/drafts", {
    method: "POST",
    body: JSON.stringify(body),
  });

/**
 * `POST /agents`. Its CONFLICT and NOT_FOUND each cover several fixes — approve the wallet's rules,
 * a wallet that already belongs to an agent, a wallet that is not found, a taken handle — so the
 * server's message is shown for them instead of the studio's generic one.
 */
export const createAgent = (body: CreateAgentInput, key: string) =>
  studioApi<AgentRecord>("/agents", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(body),
  }).catch((caught: unknown) => {
    if (
      caught instanceof StudioError &&
      (caught.code === "CONFLICT" || caught.code === "NOT_FOUND") &&
      caught.serverMessage
    ) {
      throw new StudioError(caught.code, caught.serverMessage, caught.serverMessage);
    }
    throw caught;
  });

/** `GET /agents`: every agent of the person's, each with its wallet, balance and locks. */
export const studioAgents = () => studioApi<{ agents: Agent[] }>("/agents");

export const startRun = (agentId: string, key: string) =>
  studioApi<{ runId: string; status: string }>(`/agents/${agentId}/runs`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({}),
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

export const paperOrder = (runId: string, key: string) =>
  studioApi<PaperOrder>(`/runs/${runId}/paper-order`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
  });

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
 * `POST /wallets/transfers/prepare`. 400 INVALID_TRANSFER; 409 INSUFFICIENT_FUNDS, INSUFFICIENT_GAS;
 * 404 WALLET_NOT_FOUND; 503 FEE_TOO_HIGH, NONCE_GAP, NOT_SENDABLE, WALLETS_UNAVAILABLE.
 */
export const transferPrepare = (body: TransferRequestDto) =>
  studioApi<TransferPlan>("/wallets/transfers/prepare", {
    method: "POST",
    body: JSON.stringify(body),
  });

/** `POST /wallets/transfers/confirm`: the same body and the passkey's stamp. 409 TRANSFER_ALREADY_RECORDED. */
export const transferConfirm = (body: TransferRequestDto, signed: SignedActivityDto) =>
  studioApi<{ txHash: string }>("/wallets/transfers/confirm", {
    method: "POST",
    body: JSON.stringify({ ...body, signed }),
  });
