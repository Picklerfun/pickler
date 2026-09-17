import { useCallback } from "react";
import type { AccountState } from "../account";
import { unlockStoredWallet, type Wallet } from "../wallet/wallet";

/** Wallet desbloqueada: la de la cuenta, o la guardada (pide Face ID) avisando a useAccount. Compartido por tesorería y Perpl. */
export function useUnlock(account: AccountState, onUnlock: (w: Wallet) => void): () => Promise<Wallet> {
  return useCallback(async (): Promise<Wallet> => {
    if (account.status === "unlocked") return account.wallet;
    const unlocked = await unlockStoredWallet();
    if (!unlocked) throw new Error("No stored account. Sign out and sign in again.");
    onUnlock(unlocked);
    return unlocked;
  }, [account, onUnlock]);
}
