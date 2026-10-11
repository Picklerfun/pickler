import type { MeraKit } from "./mera-ceremony";

/**
 * The libraries a Mera ceremony needs, loaded on demand rather than with the page: Mera's signing
 * session, its viem adapter, and the derivation rule the mobile app uses. The chooser asks for
 * them as it opens, so they are there when a passkey is picked; a page whose chooser never opens
 * never downloads them.
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
        // The caller's to zero. The derivation wipes every node it went through, the master
        // included; the mnemonic is a string and cannot be wiped.
        return account.deriveEvmPrivateKey(seed, 0);
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
        signTransaction: (tx) =>
          viemAccount.signTransaction({
            type: "eip1559",
            chainId: tx.chainId,
            nonce: tx.nonce,
            to: tx.to as `0x${string}`,
            data: tx.data as `0x${string}`,
            value: 0n,
            gas: BigInt(tx.gas),
            maxFeePerGas: BigInt(tx.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
          }),
        end: () => session.end(),
      };
    },
  };
}
