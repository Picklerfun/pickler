import type { TradingKey } from "../storage/perpl";

export type EnableStep = 1 | 2 | 3 | 4;
export const ENABLE_STEPS = ["Approve AUSD", "Create trading account", "Allow one-click trading", "Register trading key"] as const;

export type EnableDeps = {
  readAccountId(): Promise<bigint>;
  /** AUSD en la wallet; solo se consulta antes de crear la cuenta (después el AUSD ya está en el exchange). */
  walletAusd(): Promise<bigint>;
  readAllowance(): Promise<bigint>;
  approve(amount: bigint): Promise<void>;
  createAccount(amount: bigint): Promise<void>;
  isForwarding(): Promise<boolean | undefined>;
  allowForwarding(): Promise<void>;
  loadKey(accountId: bigint): Promise<TradingKey | undefined>;
  enrollKey(accountId: bigint): Promise<TradingKey>;
};

export class EnableError extends Error {
  constructor(readonly step: EnableStep, readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "EnableError";
  }
}

async function at<T>(step: EnableStep, onStep: (s: EnableStep) => void, run: () => Promise<T>): Promise<T> {
  onStep(step);
  try {
    return await run();
  } catch (e) {
    throw e instanceof EnableError ? e : new EnableError(step, e);
  }
}

/**
 * Reanudable: verifica antes de cada paso y nunca repite createAccount si ya hay id.
 * Paso 3 se reenvía cuando no se sabe si el forwarding está activo (no hay getter on-chain).
 */
export async function runEnable(deps: EnableDeps, amount: bigint, onStep: (step: EnableStep) => void): Promise<TradingKey> {
  let accountId = await at(1, onStep, async () => {
    const id = await deps.readAccountId();
    if (id === 0n && amount === 0n) throw new Error("This wallet has no Perpl account yet."); // reconnect sin cuenta: el gate vuelve a Enable (spec §4)
    if (id === 0n) {
      if ((await deps.walletAusd()) < amount) throw new Error("That is more than the AUSD in your wallet.");
      if ((await deps.readAllowance()) < amount) await deps.approve(amount);
    }
    return id;
  });
  if (accountId === 0n) {
    accountId = await at(2, onStep, async () => {
      await deps.createAccount(amount);
      const id = await deps.readAccountId();
      if (id === 0n) throw new Error("The trading account did not appear on-chain. Try again.");
      return id;
    });
  }
  await at(3, onStep, async () => {
    if ((await deps.isForwarding()) !== true) await deps.allowForwarding();
  });
  const id = accountId;
  return at(4, onStep, async () => (await deps.loadKey(id)) ?? deps.enrollKey(id));
}
