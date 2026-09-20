"use client";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import type {
  agentConfigSchema,
  agentResponseSchema,
  consoleOptionsSchema,
  runResponseSchema,
  eventResponseSchema,
  marketCatalogSchema,
} from "@pickler/api-schema";
export type Config = ReturnType<typeof agentConfigSchema.parse>;
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
export type Options = ReturnType<typeof consoleOptionsSchema.parse>;

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
export async function consoleApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Authentication is not configured.");
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error(messages.UNAUTHORIZED);
  }
  const response = await fetch(`/api/v1/console${path}`, {
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
    throw new Error(messages[body.error] ?? `Request failed: ${body.error ?? response.status}`);
  }
  return body as T;
}
