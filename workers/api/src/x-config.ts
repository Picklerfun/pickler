import type { Env } from "./env";

type XEnvironment = Pick<
  Env,
  | "APP_ENV"
  | "X_CLIENT_ID"
  | "X_CLIENT_SECRET"
  | "X_REDIRECT_URI"
  | "X_TOKEN_ENCRYPTION_KEY"
  | "X_TOKEN_ENCRYPTION_KEY_VERSION"
  | "X_OAUTH_ENABLED"
  | "X_READS_ENABLED"
>;

/** Defaults belong to trusted deployment configuration, never the browser's Host header. */
export function xOAuthConfiguration(env: XEnvironment) {
  const keyVersion = env.X_TOKEN_ENCRYPTION_KEY_VERSION ?? "1";
  const hosted = ["staging", "production"].includes(env.APP_ENV);
  const redirectUri =
    env.X_REDIRECT_URI ?? (hosted ? "https://app.pickler.fun/api/v1/studio/x/callback" : undefined);
  const validKeyVersion = /^[1-9]\d*$/.test(keyVersion) && Number.isSafeInteger(Number(keyVersion));

  return {
    keyVersion: Number(keyVersion),
    provider: {
      clientId: env.X_CLIENT_ID,
      clientSecret: env.X_CLIENT_SECRET,
      redirectUri,
      enabled:
        env.X_OAUTH_ENABLED === "true" &&
        /^[a-fA-F0-9]{64}$/.test(env.X_TOKEN_ENCRYPTION_KEY ?? "") &&
        validKeyVersion,
      readsEnabled: env.X_READS_ENABLED === "true",
    },
  };
}
