// Replaces Relayer's module-level `supabaseAdmin` singletons (core/supabase-admin.ts,
// kits/signing/supabase-admin.ts) with an explicit factory, so Workers can create one per
// isolate from bindings instead of reading process.env at import time.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseAdminConfig {
  url: string;
  /** Server-only secret key. Never expose it to browsers or logs. */
  secretKey: string;
  fetch?: typeof fetch;
}

export type SupabaseAdmin = SupabaseClient;

export function createSupabaseAdmin(config: SupabaseAdminConfig): SupabaseAdmin {
  return createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: config.fetch ? { fetch: config.fetch } : {},
  });
}
