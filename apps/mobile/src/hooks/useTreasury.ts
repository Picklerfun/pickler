import { useCallback, useEffect, useState } from "react";
import { accountAddress, type AccountState } from "../account";
import { readBalances, requestAusdFromFaucet, waitForReceipt } from "../wallet/chain";
import { describeError, unlockStoredWallet, type Wallet } from "../wallet/wallet";

export type Balances = { ausd: bigint; mon: bigint };

export type Treasury = {
  balances: Balances | null;
  rpcError: string;
  busy: boolean;
  notice: string;
  error: string;
  refresh: () => Promise<void>;
  getTestAusd: () => Promise<void>;
};

export function useTreasury(account: AccountState, onUnlock: (w: Wallet) => void): Treasury {
  const address = accountAddress(account);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [rpcError, setRpcError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setRpcError("");
    if (!address) {
      setBalances(null);
      return;
    }
    try {
      setBalances(await readBalances(address));
    } catch (e) {
      setBalances(null);
      setRpcError(describeError(e));
    }
  }, [address]);

  useEffect(() => {
    setNotice("");
    setError("");
    refresh();
  }, [refresh]);

  const getTestAusd = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const fresh = await readBalances(address);
      setBalances(fresh);
      if (fresh.mon === 0n) {
        throw new Error("You need test MON for gas. Get some at the Monad faucet and try again.");
      }
      let wallet: Wallet;
      if (account.status === "unlocked") {
        wallet = account.wallet;
      } else {
        const unlocked = await unlockStoredWallet();
        if (!unlocked) throw new Error("No stored account. Sign out and sign in again.");
        wallet = unlocked;
        onUnlock(wallet);
      }
      const hash = await requestAusdFromFaucet(wallet);
      setNotice(`Sent: ${hash}`);
      const status = await waitForReceipt(hash);
      setNotice(status === "success" ? `Confirmed: ${hash}` : `Reverted: ${hash}`);
      await refresh();
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  }, [address, account, onUnlock, refresh]);

  return { balances, rpcError, busy, notice, error, refresh, getTestAusd };
}
