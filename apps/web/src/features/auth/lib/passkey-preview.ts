/**
 * `/passkey?state=create`: the screen a signed-in person with no sub-organization sees — the
 * mandatory "Create your wallet" step — without a session behind it, so the design harness can
 * measure it.
 *
 * That screen is chosen by `GET /v1/signing/wallets/me` answering 404, and the API only answers
 * that to a verified JWT. The harness has none — it passes the middleware's cookie-presence check
 * and nothing else — so the honest read ends in "could not be read", never in create.
 *
 * Outside production only, gated on the build alone like the home's `?stage=` and the creation
 * flow's `?step=` sample. Pure, with `nodeEnv` an argument, so the gate is pinned in both
 * positions. Its button opens the sheet, whose challenge the API refuses without a session, so
 * nothing on it can create anything.
 */
export const PASSKEY_PREVIEWS = ["create"] as const;

export type PasskeyPreview = (typeof PASSKEY_PREVIEWS)[number];

export function passkeyPreviewFromSearch(
  nodeEnv: string | undefined,
  asked: string | string[] | undefined,
): PasskeyPreview | undefined {
  if (nodeEnv === "production") {
    return undefined;
  }
  const value = Array.isArray(asked) ? asked[0] : asked;
  return PASSKEY_PREVIEWS.find((state): state is PasskeyPreview => state === value);
}
