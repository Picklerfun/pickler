// The account, rendered without a session, so the design checks have the screen to look at.
//
// Everything on this screen is behind Supabase auth and the signing API. With neither present —
// which is every environment scripts/design runs against — `/account` renders a sign-in stub, and a
// contrast, token or type check that walks that stub reports the same green as one that walked the
// whole screen. That is the failure the verification exists to catch, so the screen has to be
// reachable. features/studio/preview.ts stands in front of the studio for the same reason and in
// the same shape.
//
// It is reachable only where it cannot be mistaken for the product: never in a production build,
// and only when authentication is not configured at all, which is already a dead end — nobody can
// sign in, so there is no real account for this to stand in front of. The screen says so in the
// banner above the section.
//
// What it does NOT do is fill in the parts of this screen that have no API. Agent sub-wallets,
// their spend caps, wallet activity, the profile's totals and the board's records are not built,
// and a fixture that drew them would teach the reader — and the next person to screenshot this —
// that they exist. So it supplies exactly the two things that are real and would otherwise need a
// session to reach: the person's profile and their master wallet. Everything else renders the same
// not-built panel a signed-in person gets, which is the point.

import { isAuthConfigured } from "../../auth/lib/config";
import type { PasskeyDto, WalletDto } from "../../auth/lib/custody-api";
import type { ProfileDto } from "../../auth/lib/pickler-api";

export interface PreviewState {
  profile: ProfileDto;
  wallet: WalletDto;
  passkeys: PasskeyDto[];
  /** What the sessions list calls the browser looking at it. No fixture has a real session. */
  session: string;
}

/**
 * Whether the fixture may stand in for the account. Both inputs are arguments rather than reads so
 * each condition can be pinned on its own: a gate tested only through the environment it happens to
 * run in is a gate tested in one position.
 */
export function previewAllowed(nodeEnv: string | undefined, authConfigured: boolean): boolean {
  return nodeEnv !== "production" && !authConfigured;
}

/** The preview, or null when a real account — or a sign-in prompt — is what should render. */
export function accountPreview(): PreviewState | null {
  if (!previewAllowed(process.env.NODE_ENV, isAuthConfigured())) {
    return null;
  }
  return {
    profile: {
      user_id: "preview",
      display_name: "Night Owl",
      handle: "nightowl",
      created_at: "2026-03-14T00:00:00.000Z",
    },
    // The canvas's own figures, so a screenshot can be held beside it. Base units as text, the way
    // the API sends them, rather than numbers this screen would have to un-round.
    wallet: {
      address: "0x7f3ab19c4d2e5f8a0b1c6d7e9f2a3b4c5d6e7c21",
      balances: {
        token: { symbol: "AUSD", decimals: 6, raw: "1240000000" },
        native: { symbol: "MON", decimals: 18, raw: "3420000000000000000" },
      },
    },
    // Two, so the fixture renders the covered state the product wants people in — and the second
    // one has never been used, which is the null this screen has to say something true about. A
    // one-passkey fixture would show the louder screen and leave that column unexercised.
    passkeys: [
      {
        id: "preview-1",
        credential_id: "preview-credential-1",
        label: "Touch ID on this Mac",
        transports: ["internal"],
        device_type: "singleDevice",
        created_at: "2026-03-14T00:00:00.000Z",
        last_used_at: "2026-09-21T00:00:00.000Z",
      },
      {
        id: "preview-2",
        credential_id: "preview-credential-2",
        label: "Backup passkey",
        transports: ["hybrid"],
        device_type: "multiDevice",
        created_at: "2026-04-02T00:00:00.000Z",
        last_used_at: null,
      },
    ],
    session: "This browser",
  };
}
