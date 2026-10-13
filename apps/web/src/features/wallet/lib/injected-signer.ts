"use client";
import { sendInjectedTokenTransaction } from "./public-token-transaction";
import {
  pinInjectedProvider,
  injectedProviderId,
  forgetInjectedWallet,
} from "./injected-providers";
import { WalletRequestError } from "./wallet-request-error";

import {
  getProvider,
  waitForProvider,
  boundedWalletRead,
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

async function read(
  provider: Eip1193Provider,
  accounts: string[],
  signal?: AbortSignal,
): Promise<SignerAccount | null> {
  const address = accounts[0];
  if (!address) {
    return null;
  }
  const [chainId, balance] = await Promise.all([
    boundedWalletRead(readChainId(provider), null, signal),
    boundedWalletRead(readBalance(provider, address), null, signal, 1_500),
  ]);
  if (signal?.aborted || chainId === null || !Number.isSafeInteger(chainId)) {
    return null;
  }
  return { address, chainId, balance, providerId: injectedProviderId(provider) };
}

export const injectedSigner: SignerAdapter = {
  kind: "injected",

  unavailableReason: () =>
    getProvider() === null ? "No browser wallet is installed on this device." : null,

  resume: async (signal) => {
    const provider = await waitForProvider(signal);
    if (!provider || signal?.aborted) {
      return null;
    }
    pinInjectedProvider(provider);
    const accounts = await boundedWalletRead(readAccounts(provider), [], signal);
    return read(provider, accounts, signal);
  },

  connect: async () => {
    const provider = getProvider();
    if (!provider) {
      return null;
    }
    pinInjectedProvider(provider);
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

  sendTokenTransaction: async (prepared, wallet, token) => {
    const provider = getProvider();
    if (!provider) {
      throw new Error("Browser wallet unavailable.");
    }
    return sendInjectedTokenTransaction(provider, prepared, wallet, token);
  },
  disconnect: async () => {
    const provider = getProvider();
    forgetInjectedWallet();
    if (provider) {
      await revokeAccess(provider);
    }
  },

  subscribe: (onChange) => {
    const provider = getProvider();
    if (!provider) {
      return () => {};
    }
    let revision = 0;
    let live = true;
    const settle = async (accounts?: string[]) => {
      const mine = ++revision;
      const selected = accounts ?? (await boundedWalletRead(readAccounts(provider), []));
      const account = await read(provider, selected);
      if (live && mine === revision) {
        onChange(account);
      }
    };
    const onAccounts = (...args: never[]) => void settle((args[0] ?? []) as string[]);
    const onChain = () => void settle();

    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      live = false;
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  },

  switchChain: async () => {
    const provider = getProvider();
    if (!provider) {
      throw new WalletRequestError({ code: 4100 }, "wallet_switchEthereumChain");
    }
    await switchToTarget(provider);
    return read(provider, await readAccounts(provider));
  },
};
