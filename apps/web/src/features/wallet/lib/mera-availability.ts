/**
 * Where the passkey wallet may be offered. Pure, and taking the place as an argument, so every
 * branch is pinned without a browser — the same shape as `productFor(host, hosts)`.
 *
 * Two rules decide it (docs/specs/mera-web-v1.md §4). The page must be the relying party itself:
 * a passkey for `pickler.fun` could technically be asked for from any subdomain, and that is
 * exactly what must not happen on the studio's host, where the Turnkey passkeys live. And the
 * studio's host is refused whatever else is configured, so a mistake in configuration cannot put
 * both kinds of passkey behind one prompt.
 */

export interface MeraPlace {
  /** The page's hostname, without a port. */
  hostname: string;
  /** The studio's host: Turnkey's relying party. Never Mera's. */
  studioHost: string;
  /** Mera's relying party: `pickler.fun`, the same as the mobile app's. */
  relyingParty: string;
  /** A production build. Loopback is only a place to work on this outside one. */
  production: boolean;
  /** `NEXT_PUBLIC_MERA_WEB` is not `off`. */
  enabled: boolean;
}

export type MeraAvailability =
  { offered: true; rpId: string; note: string | null } | { offered: false; reason: string };

const LOCAL_NOTE =
  "Development: this passkey is for localhost. It is not your app account, and a passkey made " +
  "in the local studio shares its prompt.";

export function meraAvailability(place: MeraPlace): MeraAvailability {
  const hostname = place.hostname.toLowerCase();
  const relyingParty = place.relyingParty.toLowerCase();

  if (!place.enabled) {
    return { offered: false, reason: "The passkey wallet is switched off here." };
  }
  if (hostname === place.studioHost.toLowerCase()) {
    return {
      offered: false,
      reason: `The passkey wallet belongs to the marketplace, on ${relyingParty}.`,
    };
  }
  if (hostname === relyingParty) {
    return { offered: true, rpId: relyingParty, note: null };
  }
  if (!place.production && hostname === "localhost") {
    return { offered: true, rpId: "localhost", note: LOCAL_NOTE };
  }
  if (!place.production && hostname === "127.0.0.1") {
    // An address cannot be a relying party; the name can.
    return { offered: false, reason: "Open this site on localhost to use the passkey wallet." };
  }
  return { offered: false, reason: `The passkey wallet opens on ${relyingParty}.` };
}
