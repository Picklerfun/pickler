"use client";

import {
  getProvider,
  readAccounts,
  readBalance,
  readChainId,
  requestAccounts,
  revokeAccess,
  switchToTarget,
  type Eip1193Provider,
} from "./provider";
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
