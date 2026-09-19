// Public configuration only. NEXT_PUBLIC_* values are inlined into the browser bundle.

export const authConfig = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  apiUrl: (process.env.NEXT_PUBLIC_PICKLER_API_URL ?? "").replace(/\/$/, ""),
  /** Chain id put in Sign-In with Ethereum messages. */
  siweChainId: Number(process.env.NEXT_PUBLIC_SIWE_CHAIN_ID ?? "10143"),
};

export const isAuthConfigured = () =>
  Boolean(authConfig.supabaseUrl && authConfig.supabasePublishableKey && authConfig.apiUrl);
