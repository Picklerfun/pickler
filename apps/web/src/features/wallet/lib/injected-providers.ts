"use client";
import type { Eip1193Provider } from "./provider";

export interface InjectedWallet {
  id: string;
  name: string;
  provider: Eip1193Provider;
}
interface Registry {
  entries: InjectedWallet[];
  snapshot: readonly InjectedWallet[];
  listeners: Set<() => void>;
  selected: InjectedWallet | null;
}
const registries = new WeakMap<Window, Registry>();
const EMPTY: readonly InjectedWallet[] = [];
const STORAGE = "pk.wallet.provider";

function isProvider(value: unknown): value is Eip1193Provider {
  return Boolean(
    value && typeof value === "object" && typeof (value as Eip1193Provider).request === "function",
  );
}
function legacyWallet(provider: Eip1193Provider): InjectedWallet {
  const marked = provider as Eip1193Provider & { isRabby?: boolean; isMetaMask?: boolean };
  if (marked.isRabby) {
    return { id: "io.rabby", name: "Rabby", provider };
  }
  if (marked.isMetaMask) {
    return { id: "io.metamask", name: "MetaMask", provider };
  }
  return { id: "legacy", name: "Browser wallet", provider };
}
function remember(id: string | null) {
  try {
    if (id) {
      window.localStorage.setItem(STORAGE, id);
    } else {
      window.localStorage.removeItem(STORAGE);
    }
  } catch {
    // The selected provider stays pinned for this page when storage is unavailable.
  }
}
export function rememberedInjectedWallet(): string | null {
  try {
    return window.localStorage.getItem(STORAGE);
  } catch {
    return null;
  }
}
function registry(): Registry | null {
  if (typeof window === "undefined") {
    return null;
  }
  const existing = registries.get(window);
  if (existing) {
    return existing;
  }
  const state: Registry = { entries: [], snapshot: EMPTY, listeners: new Set(), selected: null };
  registries.set(window, state);
  const add = (wallet: InjectedWallet) => {
    if (
      state.entries.some((entry) => entry.provider === wallet.provider || entry.id === wallet.id)
    ) {
      return;
    }
    state.entries.push(wallet);
    state.snapshot = [...state.entries];
    for (const listener of state.listeners) {
      listener();
    }
  };
  const legacy = () => {
    if (isProvider(window.ethereum)) {
      const providers = (window.ethereum as Eip1193Provider & { providers?: unknown[] }).providers;
      for (const provider of providers ?? [window.ethereum]) {
        if (isProvider(provider)) {
          add(legacyWallet(provider));
        }
      }
    }
  };
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== "object") {
      return;
    }
    const { info, provider } = detail as {
      info?: { rdns?: unknown; name?: unknown };
      provider?: unknown;
    };
    if (
      !isProvider(provider) ||
      typeof info?.rdns !== "string" ||
      !/^[a-z0-9.-]{1,100}$/i.test(info.rdns)
    ) {
      return;
    }
    const name =
      typeof info.name === "string"
        ? info.name.replace(/[\u0000-\u001f]/g, "").slice(0, 60)
        : "Browser wallet";
    add({ id: info.rdns, name: name || "Browser wallet", provider });
  });
  window.addEventListener("ethereum#initialized", legacy);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  legacy();
  return state;
}
export function injectedWalletSnapshot(): readonly InjectedWallet[] {
  return registry()?.snapshot ?? EMPTY;
}
export const injectedWalletServerSnapshot = () => EMPTY;
export function subscribeInjectedWallets(listener: () => void) {
  const state = registry();
  state?.listeners.add(listener);
  return () => {
    state?.listeners.delete(listener);
  };
}

/** A remembered extension never silently falls through to a different installed wallet. */
export function selectedInjectedProvider(): Eip1193Provider | null {
  const state = registry();
  if (!state) {
    return null;
  }
  if (state.selected) {
    return state.selected.provider;
  }
  const remembered = rememberedInjectedWallet();
  if (remembered) {
    const known = state.entries.find((entry) => entry.id === remembered);
    if (known) {
      return known.provider;
    }
    // Legacy extensions may inject late without an announcement; only match the remembered kind.
    if (isProvider(window.ethereum) && legacyWallet(window.ethereum).id === remembered) {
      return window.ethereum;
    }
    return null;
  }
  return isProvider(window.ethereum) ? window.ethereum : (state.entries[0]?.provider ?? null);
}
export function selectInjectedWallet(id: string) {
  const state = registry();
  const wallet = state?.entries.find((entry) => entry.id === id);
  if (!wallet || !state) {
    throw new Error("The selected browser wallet is unavailable. Open it and reconnect.");
  }
  state.selected = wallet;
  remember(id);
}
export function injectedProviderId(provider: Eip1193Provider): string | undefined {
  return (
    registry()?.entries.find((entry) => entry.provider === provider)?.id ??
    legacyWallet(provider).id
  );
}
export function pinInjectedProvider(provider: Eip1193Provider): string | undefined {
  const state = registry();
  if (!state) {
    return undefined;
  }
  const wallet =
    state.entries.find((entry) => entry.provider === provider) ?? legacyWallet(provider);
  state.selected = wallet;
  remember(wallet.id);
  return wallet.id;
}
export function forgetInjectedWallet() {
  const state = registry();
  if (state) {
    state.selected = null;
  }
  remember(null);
}
