// Ported from Relayer apps/web/lib/passkey/passkey-setup-flow.tsx and use-add-passkey.ts
// (commit bb6bb1226e92). Changed: the ceremony is a function over a CredentialsContainer rather
// than a hook over `navigator.credentials`. A hook cannot be driven from node:test; a function
// taking the container can, and every assertion below about what the operating system is handed
// — the challenge bytes, the attachment, the exclusion list — exists because of that.

import { base64urlToBuffer, bufferToBase64url, normalizeTransports } from "./webauthn";
import type { AttestationDto, ChallengeOptionsDto } from "./custody-api";

/**
 * Which authenticator to ask for. "platform" is this device's own biometric; "cross-platform" is
 * what the operating system turns into a QR code for a phone or a security key.
 */
export type Attachment = "platform" | "cross-platform";

/**
 * Runs the WebAuthn creation ceremony and returns the attestation in the base64url the API takes.
 *
 * @param credentials usually `navigator.credentials`; injected so this is testable.
 */
export async function createPasskey(
  credentials: CredentialsContainer,
  options: ChallengeOptionsDto,
  attachment: Attachment,
): Promise<AttestationDto> {
  const exclude = options.excludeCredentials ?? [];
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64urlToBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: base64urlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams.map((param) => ({
      type: param.type,
      alg: param.alg,
    })),
    authenticatorSelection: {
      authenticatorAttachment: attachment,
      residentKey: options.authenticatorSelection?.residentKey ?? "preferred",
      userVerification: options.authenticatorSelection?.userVerification ?? "preferred",
    },
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    attestation: options.attestation ?? "none",
    // Only when there is something to exclude. An empty array is not the same as an absent
    // field to an authenticator, and this list is the whole of the defence against a device
    // enrolling itself twice, so it must be right in both directions.
    ...(exclude.length
      ? {
          excludeCredentials: exclude.map((credential) => ({
            id: base64urlToBuffer(credential.id),
            type: credential.type,
            // The API refuses any transport outside lib.dom's AuthenticatorTransport before it
            // ever records one, so what comes back here is always one of those five words. The
            // test pins that correspondence rather than trusting this sentence.
            ...(credential.transports
              ? { transports: credential.transports as AuthenticatorTransport[] }
              : {}),
          })),
        }
      : {}),
  };

  const credential = await credentials.create({ publicKey });
  if (!credential) {
    throw new Error("The browser did not create a passkey");
  }
  // `instanceof PublicKeyCredential` is the usual narrowing and is unavailable outside a browser,
  // which is the whole reason this function takes its container as an argument. The cast is the
  // one place that costs; everything downstream is checked against the DOM types.
  const created = credential as PublicKeyCredential;
  const response = created.response as AuthenticatorAttestationResponse;
  return {
    credentialId: bufferToBase64url(created.rawId),
    clientDataJson: bufferToBase64url(response.clientDataJSON),
    attestationObject: bufferToBase64url(response.attestationObject),
    // getTransports() is optional and absent on some authenticators, so it is called only when
    // it is there; normalizeTransports turns nothing into ["internal"].
    transports: normalizeTransports(response.getTransports?.()),
  };
}

/**
 * Turns a ceremony failure into something worth showing, or null when there is nothing to say.
 *
 * NotAllowedError is the browser's word for "the person dismissed the prompt, or it timed out".
 * That is a decision, not a fault, and a red banner for it is rude — so it returns null and the
 * caller shows nothing.
 */
export function describeCeremonyFailure(error: unknown): string | null {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
      return null;
    case "InvalidStateError":
      return "This device already has a passkey for your account. Use it to sign in instead.";
    case "SecurityError":
      // Almost always an rp.id that does not match the page's origin, which is what happens in a
      // preview deployment or inside an iframe.
      return "Passkeys cannot be created from this address. Open Pickler at its own address and try again.";
    case "NotSupportedError":
      return "This device does not support the kind of passkey Pickler needs.";
    default:
      return "Setting up the passkey did not finish. Please try again.";
  }
}
