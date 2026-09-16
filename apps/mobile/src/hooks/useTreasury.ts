import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { accountAddress, type AccountState } from "../account";
import { MONADSCAN_KEY } from "../config/explorer";
import { estimateAusdTransferFee, readBalances, requestAusdFromFaucet, sendAusd, waitForReceipt } from "../wallet/chain";
import { fetchAusdTransfers, type Movement, type MovementKind, pendingMovement, toMovements } from "../wallet/explorer";
import { describeError, unlockStoredWallet, type Wallet } from "../wallet/wallet";

export type Balances = { ausd: bigint; mon: bigint };

export type Treasury = {
  balances: Balances | null;
  rpcError: string;
  busy: boolean;
  notice: string;
  error: string;
  movements: Movement[] | null;
  movementsError: string;
  pending: Movement[];
  refresh: () => Promise<void>;
  refreshMovements: () => Promise<void>;
  getTestAusd: () => Promise<void>;
  estimateFee: (to: Address, amount: bigint) => Promise<bigint>;
  withdraw: (to: Address, amount: bigint, onSent: (hash: Hex) => void) => Promise<"success" | "reverted">;
};

const FAUCET_AMOUNT = 10_000_000_000n; // 10,000 AUSD, lo que da requestFunds

export function useTreasury(account: AccountState, onUnlock: (w: Wallet) => void): Treasury {
  const address = accountAddress(account);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [rpcError, setRpcError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [movementsError, setMovementsError] = useState("");
  const [pending, setPending] = useState<Movement[]>([]);

  const refreshMovements = useCallback(async () => {
    setMovementsError("");
    if (!address) {
      setMovements(null);
      return;
    }
    try {
      setMovements(toMovements(await fetchAusdTransfers(address, MONADSCAN_KEY), address));
    } catch (e) {
      setMovementsError(describeError(e) || "Couldn't load movements.");
    }
  }, [address]);

  /** Lee saldos + movimientos en paralelo. No toca `pending`: eso es responsabilidad de `refresh`/`track`. */
  const load = useCallback(async () => {
    setRpcError("");
    if (!address) {
      setBalances(null);
      void refreshMovements();
      return;
    }
    const [result] = await Promise.all([
      readBalances(address).then((b) => ({ ok: true as const, b })).catch((e: unknown) => ({ ok: false as const, e })),
      refreshMovements(),
    ]);
    if (result.ok) {
      setBalances(result.b);
    } else {
      setBalances(null);
      setRpcError(describeError(result.e));
    }
  }, [address, refreshMovements]);

  const refresh = useCallback(async () => {
    // las Reverted viven hasta el siguiente refresh manual; Sign out vacía pending
    setPending((p) => (address ? p.filter((m) => m.status === "Confirming") : []));
    await load();
  }, [address, load]);

  useEffect(() => {
    setNotice("");
    setError("");
    void refresh();
  }, [refresh]);

  /** Wallet desbloqueada: la de la cuenta, o la guardada (pide Face ID) avisando a useAccount. */
  const openWallet = useCallback(async (): Promise<Wallet> => {
    if (account.status === "unlocked") return account.wallet;
    const unlocked = await unlockStoredWallet();
    if (!unlocked) throw new Error("No stored account. Sign out and sign in again.");
    onUnlock(unlocked);
    return unlocked;
  }, [account, onUnlock]);

  /** Registra la tx en vuelo, espera el recibo y recarga (sin tocar `pending` de otras filas). Quita la fila si confirmó; la deja como Reverted si no; la quita también si esperar el recibo falla (timeout/RPC), y relanza. */
  const track = useCallback(async (kind: MovementKind, amount: bigint, hash: Hex): Promise<"success" | "reverted"> => {
    const row = pendingMovement(kind, amount, hash);
    setPending((p) => [row, ...p]);
    let status: "success" | "reverted";
    try {
      status = await waitForReceipt(hash);
    } catch (e) {
      setPending((p) => p.filter((m) => m.hash !== hash));
      throw e;
    }
    setPending((p) => status === "success" ? p.filter((m) => m.hash !== hash) : p.map((m) => m.hash === hash ? { ...m, status: "Reverted" } : m));
    await load();
    return status;
  }, [load]);

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
      const wallet = await openWallet();
      const hash = await requestAusdFromFaucet(wallet);
      setNotice(`Sent: ${hash}`);
      const status = await track("Faucet", FAUCET_AMOUNT, hash);
      setNotice(status === "success" ? `Confirmed: ${hash}` : `Reverted: ${hash}`);
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  }, [address, openWallet, track]);

  const estimateFee = useCallback(async (to: Address, amount: bigint): Promise<bigint> => {
    if (!address) throw new Error("No account.");
    return estimateAusdTransferFee(address, to, amount);
  }, [address]);

  const withdraw = useCallback(async (to: Address, amount: bigint, onSent: (hash: Hex) => void): Promise<"success" | "reverted"> => {
    if (!address) throw new Error("No account.");
    const fresh = await readBalances(address);
    setBalances(fresh);
    if (fresh.mon === 0n) throw new Error("You need test MON for gas. Get some at the Monad faucet and try again.");
    if (amount > fresh.ausd) throw new Error("That is more than the AUSD available.");
    const wallet = await openWallet();
    const hash = await sendAusd(wallet, to, amount);
    onSent(hash);
    return track("Withdrawal", amount, hash);
  }, [address, openWallet, track]);

  return { balances, rpcError, busy, notice, error, movements, movementsError, pending, refresh, refreshMovements, getTestAusd, estimateFee, withdraw };
}
