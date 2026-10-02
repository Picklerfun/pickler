"use client";

import {
  getProvider,
  readAccounts,
  readBalance,
  readChainId,
  requestAccounts,
  revokeAccess,
  switchToTarget,
  TARGET_CHAIN,
  type Eip1193Provider,
} from "./provider";
import { challenge, join } from "./connect";
import { fromInjectedProvider } from "./signer-adapters";
import type { SignerAccount, SignerAdapter } from "./signer";

/**
 * The wallet the person brought: MetaMask, Rabby, anything that injects EIP-1193.
 *
 * All of it was already here; this file only gives it the shape the rest of the site now asks for.
 * It is the signer that can be pointed at the wrong chain and the one that changes under the page,
 * so it is the only one that implements `switchChain` and `subscribe`.
 */

async function read(provider: Eip1193Provider, accounts: string[]): Promise<SignerAccount | null> {
  const address = accounts[0];
  if (!address) {
    return null;
  }
  return {
    address,
    chainId: await readChainId(provider),
    balance: await readBalance(provider, address),
  };
}

export const injectedSigner: SignerAdapter = {
  kind: "injected",

  unavailableReason: () =>
    getProvider() === null ? "No browser wallet is installed on this device." : null,

  resume: async () => {
    const provider = getProvider();
    // `eth_accounts` never prompts: someone who connected yesterday is picked back up, and someone
    // who never did is left alone.
    return provider ? read(provider, await readAccounts(provider)) : null;
  },

  connect: async () => {
    const provider = getProvider();
    if (!provider) {
      return null;
    }
    return read(provider, await requestAccounts(provider));
  },

  // The account the wallet has selected signs the server's message, as it would to sign in, and
  // the signature goes with the session of the account being given up. Nothing here connects it:
  // the page keeps the wallet it had.
  join: async (token: string, joining: string) => {
    const provider = getProvider();
    if (!provider) {
      return null;
    }
    const [address] = await requestAccounts(provider);
    if (!address) {
      return null;
    }
    const chainId = (await readChainId(provider)) ?? TARGET_CHAIN.chainId;
    // Not the sign-in message: the wallet shows, and signs, that it lets `joining` in.
    const message = await challenge(address, chainId, fetch, joining);
    const signature = await fromInjectedProvider(provider, address, chainId).signMessage(message);
    return { address, session: await join(message, signature, token) };
  },

  disconnect: async () => {
    const provider = getProvider();
    if (provider) {
      await revokeAccess(provider);
    }
  },

  subscribe: (onChange) => {
    const provider = getProvider();
    if (!provider) {
      return () => {};
    }
    const settle = (accounts: string[]) => void read(provider, accounts).then(onChange);
    const onAccounts = (...args: never[]) => settle((args[0] ?? []) as string[]);
    const onChain = () => void readAccounts(provider).then(settle);

    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  },

  switchChain: async () => {
    const provider = getProvider();
    if (!provider || !(await switchToTarget(provider))) {
      return null;
    }
    return read(provider, await readAccounts(provider));
  },
};
