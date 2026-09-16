import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountState } from "../account";
import { clearStoredAccount, loadStoredAccount } from "../storage/storage";
import type { Wallet } from "../wallet/wallet";

export type AccountActions = {
  onWallet: (wallet: Wallet) => void;
  lock: () => void;
  signOut: () => Promise<void>;
};

/** Cuenta guardada en el dispositivo. `null` mientras carga; después `none` / `locked` / `unlocked`. */
export function useAccount(): { account: AccountState | null } & AccountActions {
  const [account, setAccount] = useState<AccountState | null>(null);
  const ref = useRef(account);
  ref.current = account;

  // Termina la sesión de firma saliente cuando la wallet deja el estado.
  const replace = useCallback((next: AccountState) => {
    const cur = ref.current;
    if (cur?.status === "unlocked" && (next.status !== "unlocked" || next.wallet !== cur.wallet)) {
      cur.wallet.session.end();
    }
    ref.current = next;
    setAccount(next);
  }, []);

  // Arranque: solo la dirección (sin gate). Nada de Face ID aquí.
  useEffect(() => {
    let stale = false;
    loadStoredAccount()
      .then((s) => !stale && setAccount(s ? { status: "locked", ...s } : { status: "none" }))
      .catch(() => !stale && setAccount({ status: "none" }));
    return () => {
      stale = true;
    };
  }, []);

  const onWallet = useCallback((wallet: Wallet) => replace({ status: "unlocked", wallet }), [replace]);

  const lock = useCallback(() => {
    const cur = ref.current;
    if (cur?.status === "unlocked") {
      replace({ status: "locked", address: cur.wallet.address, credentialId: cur.wallet.credentialId });
    }
  }, [replace]);

  const signOut = useCallback(async () => {
    await clearStoredAccount();
    replace({ status: "none" });
  }, [replace]);

  return { account, onWallet, lock, signOut };
}
