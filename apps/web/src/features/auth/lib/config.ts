// Public configuration only. NEXT_PUBLIC_* values are inlined into the browser bundle.

export const authConfig = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  apiUrl: "/api",
  /**
   * Whether the Supabase project has X (Supabase still calls it `twitter`) credentials on it.
   * The account screen leaves the button out when it does not: a button that cannot work is
   * worse than an absent one.
   */
  xOAuthEnabled: process.env.NEXT_PUBLIC_OAUTH_X_ENABLED === "true",
};

export const isAuthConfigured = () =>
  Boolean(authConfig.supabaseUrl && authConfig.supabasePublishableKey && authConfig.apiUrl);
