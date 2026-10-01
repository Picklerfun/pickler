import type { PasskeyDto } from "./custody-api";

/**
 * How `/passkey` is entered by a design check.
 *
 * The page reads a session, the master wallet, the profile and the passkeys before it draws
 * anything, and the design harness has none of them: without this its only measurable screen is
 * "your account could not be read". `?state=add` draws the add-a-passkey screen from one fixture
 * passkey, with no session and no reads. Outside production only, gated on the build alone like
 * the signup's `?state=passkey`. Pure, with `nodeEnv` an argument, so the gate is pinned in both
 * positions. The button opens the sheet, whose challenge the API refuses without a session, so
 * nothing on the screen can add anything.
 */
export const PASSKEY_PREVIEWS = ["add"] as const;

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

/** The preview's account: one passkey, made on a fixed day so the server and the browser agree. */
export const PREVIEW_PASSKEYS: PasskeyDto[] = [
  {
    id: "preview-passkey",
    credential_id: "preview-credential",
    label: "This Mac",
    transports: ["internal"],
    device_type: "platform",
    created_at: "2026-03-14T00:00:00.000Z",
    last_used_at: null,
  },
];
