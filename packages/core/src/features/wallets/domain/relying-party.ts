/**
 * The relying party Mera's passkey is enrolled against, on the web and in the app
 * (docs/specs/mobile-monorepo-v1.md, W1). With WebAuthn PRF an assertion for it is the seed of
 * the marketplace wallet, so no other credential may share it.
 */
export const MERA_RELYING_PARTY = "pickler.fun";

export type RelyingPartyProblem = "shared_with_mera" | "localhost_deployed";

const LOCAL_ENVIRONMENTS = new Set(["local", "development"]);

/**
 * Why Turnkey custody must not be composed with this relying party, or null when it may.
 *
 * A Turnkey passkey authorises activities; Mera's is turned into key material. Enrolled against
 * the same relying party the two appear in one picker, and the choice cannot be undone for anyone
 * who has enrolled. `localhost` outside local development is a deployment that kept its
 * development value, where no ceremony could complete anyway.
 */
export function turnkeyRelyingPartyProblem(
  rpId: string,
  appEnv: string,
): RelyingPartyProblem | null {
  const host = rpId.trim().toLowerCase().replace(/\.$/, "");

  if (host === MERA_RELYING_PARTY) {
    return "shared_with_mera";
  }
  if (host === "localhost" && !LOCAL_ENVIRONMENTS.has(appEnv)) {
    return "localhost_deployed";
  }
  return null;
}
