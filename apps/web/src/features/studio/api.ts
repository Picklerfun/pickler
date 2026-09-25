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
  AgentDraftDto,
} from "@pickler/api-schema";
export type Config = ReturnType<typeof agentConfigSchema.parse>;
export { DEFAULT_PROFILE, type Profile } from "./profile";
export type Agent = ReturnType<typeof agentResponseSchema.parse> & {
  productId?: string;
  name?: string;
  handle?: string;
};
export type Run = ReturnType<typeof runResponseSchema.parse>;
export type RunEvent = ReturnType<typeof eventResponseSchema.parse>;
export type Catalog = ReturnType<typeof marketCatalogSchema.parse>;
export type Plugin = {
  id: NonNullable<Config["plugins"]>["enabled"][number];
  version: string;
  tools: Config["tools"];
};
export type Options = ReturnType<typeof studioOptionsSchema.parse>;
export type PaperOrder = ReturnType<typeof paperOrderSchema.parse>;
export type CreateAgentInput = ReturnType<typeof createAgentSchema.parse>;
export type { AgentDraftDto };

/**
 * The studio transport answers a failure with `{ error: CODE }`. The code is what the Studio
 * branches on — it decides which blocked state to show and which control to lock — so it travels
 * with the error instead of being flattened into prose.
 */
export class StudioError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StudioError";
  }
}
export const errorCode = (caught: unknown): string =>
  caught instanceof StudioError ? caught.code : "";

const messages: Record<string, string> = {
  NOT_READY:
    "Scheduling requires a connection check and a successful manual research with the current settings.",
  ADMISSIONS_PAUSED:
    "The operator has paused new research. Your existing results remain available.",
  RESEARCH_ACCESS_DENIED: "Research access is pending or you do not own this workspace.",
  CONFLICT:
    "The configuration changed or this handle is already taken. Reload before saving again.",
  QUOTA:
    "This agent has reached its research allowance. Try again after the rolling window clears.",
  PLUGIN_NOT_CONFIGURED: "An enabled plugin needs operator credentials before it can run.",
  PLUGIN_DISABLED: "A capability required for this action is disabled.",
  UNAUTHORIZED: "Your session has expired. Sign in again.",
  INVALID_INPUT: "Check the fields. Select at least one sport and valid limits.",
};
export async function studioApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Authentication is not configured.");
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new StudioError("UNAUTHORIZED", messages.UNAUTHORIZED!);
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
    throw new StudioError(code, messages[code] ?? `Request failed: ${body?.message ?? code}`);
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

export const createAgent = (body: CreateAgentInput, key: string) =>
  studioApi<Agent>("/agents", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(body),
  });

export const startRun = (agentId: string, key: string) =>
  studioApi<{ runId: string; status: string }>(`/agents/${agentId}/runs`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({}),
  });

export const runEvents = (runId: string) =>
  studioApi<{ events: RunEvent[] }>(`/runs/${runId}/events`);

export const run = (runId: string) => studioApi<Run>(`/runs/${runId}`);

export const paperOrder = (runId: string, key: string) =>
  studioApi<PaperOrder>(`/runs/${runId}/paper-order`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
  });

/** `PUT /agents/:id/config`: the only writer of anything but `spend` or `schedule.enabled`. */
export const updateConfig = (agentId: string, expectedVersion: number, config: Config) =>
  studioApi<Agent>(`/agents/${agentId}/config`, {
    method: "PUT",
    body: JSON.stringify({ expectedVersion, config }),
  });

/** A convenience over `updateConfig`: the API has no route for the interval alone. */
export const setInterval = (
  agentId: string,
  expectedVersion: number,
  config: Config,
  hours: number,
) => updateConfig(agentId, expectedVersion, { ...config, intervalHours: hours });

export const saveLimits = (agentId: string, perCallAusd: number, perDayAusd: number) =>
  studioApi<Agent>(`/agents/${agentId}/limits`, {
    method: "PUT",
    body: JSON.stringify({ perCallAusd, perDayAusd }),
  });

export const setSchedule = (agentId: string, enabled: boolean) =>
  studioApi<{ ok: true }>(`/agents/${agentId}/schedule`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });

export interface DepositPrepared {
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
    throw new StudioError(code, messages[code] ?? body?.message ?? "Request failed");
  }
  return body.data as T;
}

export interface UnsignedActivityDto {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}

export interface SignedActivityDto {
  url: string;
  body: string;
  stamp: { stampHeaderName: string; stampHeaderValue: string };
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

export type PrepareWalletResult =
  { existing: { walletId: string; address: string } } | UnsignedActivityDto;

export const prepareWallet = (handle: string) =>
  envelopeApi<{ existing: { wallet_id: string; address: string } } | UnsignedActivityDto>(
    "/v1/signing/agents/wallet/prepare",
    { method: "POST", body: JSON.stringify({ handle }) },
  ).then((data): PrepareWalletResult =>
    "existing" in data
      ? { existing: { walletId: data.existing.wallet_id, address: data.existing.address } }
      : data,
  );

export const confirmWallet = (handle: string, signed: SignedActivityDto) =>
  envelopeApi<{ wallet_id: string; address: string }>("/v1/signing/agents/wallet/confirm", {
    method: "POST",
    body: JSON.stringify({ handle, signed }),
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

export interface HandleAvailability {
  handle: string;
  available: boolean;
  reason?: "too_short" | "too_long" | "invalid_characters" | "reserved" | "taken";
}

/** `GET /v1/handles/:handle/availability`: public, and shared with the account handle check. */
export const handleAvailable = (handle: string) =>
  envelopeApi<HandleAvailability>(`/v1/handles/${encodeURIComponent(handle)}/availability`);
