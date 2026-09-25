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
