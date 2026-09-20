"use client";

// Supabase Auth in the browser, with the publishable key. Sessions are stored in cookies
// (@supabase/ssr) so server routes can read them later. Only authentication happens here;
// profile data goes through the Pickler API.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authConfig, isAuthConfigured } from "./config";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isAuthConfigured()) {
    return null;
  }
  client ??= createBrowserClient(authConfig.supabaseUrl, authConfig.supabasePublishableKey, {
    cookieOptions: { secure: window.location.protocol === "https:" },
  });
  return client;
}
