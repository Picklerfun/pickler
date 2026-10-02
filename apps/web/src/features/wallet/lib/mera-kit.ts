import type { MeraKit } from "./mera-ceremony";

/**
 * The libraries a Mera ceremony needs, loaded when a ceremony starts rather than with the page:
 * Mera's signing session, its viem adapter, and the derivation rule the mobile app uses. A page
 * that never opens the passkey wallet never downloads them, and never has them in memory.
 */
export async function loadMeraKit(): Promise<MeraKit> {
  const [mera, meraViem, account] = await Promise.all([
    import("@category-labs/mera"),
    import("@category-labs/mera/viem"),
    import("@pickler/mera-account"),
  ]);

  return {
    privateKeyFromPrf(prfOutput) {
      let seed: Uint8Array | undefined;
      try {
        seed = account.mnemonicToSeed(account.prfOutputToMnemonic(prfOutput));
        // A copy: the node that derived it keeps its own, and this one is the caller's to zero.
        return Uint8Array.from(account.deriveEvmPrivateKey(seed, 0));
      } finally {
        seed?.fill(0);
      }
    },

    openKey(privateKey) {
      const session = mera.createSecp256k1SigningSession({ privateKey });
      const viemAccount = meraViem.toViemAccount(session);
      return {
        address: mera.getEvmAddress(session.publicKey),
        signMessage: (message) => viemAccount.signMessage({ message }),
        end: () => session.end(),
      };
    },
  };
}
