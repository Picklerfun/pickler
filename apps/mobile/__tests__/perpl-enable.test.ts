import type { TradingKey } from "../src/storage/perpl";
import { ENABLE_STEPS, EnableError, type EnableDeps, runEnable } from "../src/perpl/enable";

const KEY: TradingKey = { address: "0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f", accountId: 619n, apiKey: "k", privateKey: new Uint8Array(32) };

function deps(over: Partial<EnableDeps> = {}) {
  const d = {
    readAccountId: jest.fn(async () => 0n),
    walletAusd: jest.fn(async () => 1_000_000_000n),
    readAllowance: jest.fn(async () => 0n),
    approve: jest.fn(async () => {}),
    createAccount: jest.fn(async () => {}),
    isForwarding: jest.fn(async () => undefined as boolean | undefined),
    allowForwarding: jest.fn(async () => {}),
    loadKey: jest.fn(async () => undefined as TradingKey | undefined),
    enrollKey: jest.fn(async () => KEY),
    ...over,
  };
  return d;
}

test("fresh wallet: approve → createAccount → forwarding → enroll, reporting each step", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 0n).mockResolvedValueOnce(0n).mockResolvedValueOnce(619n) });
  const steps: number[] = [];
  await expect(runEnable(d, 100_000_000n, (s) => steps.push(s))).resolves.toEqual(KEY);
  expect(steps).toEqual([1, 2, 3, 4]);
  expect(d.approve).toHaveBeenCalledWith(100_000_000n);
  expect(d.createAccount).toHaveBeenCalledTimes(1);
  expect(d.allowForwarding).toHaveBeenCalledTimes(1);
  expect(d.enrollKey).toHaveBeenCalledWith(619n);
  expect(ENABLE_STEPS).toEqual(["Approve AUSD", "Create trading account", "Allow one-click trading", "Register trading key"]);
});

test("skips approve when the allowance already covers the amount", async () => {
  const d = deps({ readAllowance: jest.fn(async () => 100_000_000n), readAccountId: jest.fn(async () => 0n).mockResolvedValueOnce(0n).mockResolvedValueOnce(619n) });
  await runEnable(d, 100_000_000n, () => {});
  expect(d.approve).not.toHaveBeenCalled();
  expect(d.createAccount).toHaveBeenCalledTimes(1);
});

test("with an existing account it never calls approve or createAccount again", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 619n) });
  const steps: number[] = [];
  await runEnable(d, 100_000_000n, (s) => steps.push(s));
  expect(d.approve).not.toHaveBeenCalled();
  expect(d.createAccount).not.toHaveBeenCalled();
  expect(steps).toEqual([1, 3, 4]);
});

test("skips forwarding when it is known to be on, and enrolment when a key is stored", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 619n), isForwarding: jest.fn(async () => true), loadKey: jest.fn(async () => KEY) });
  await expect(runEnable(d, 100_000_000n, () => {})).resolves.toEqual(KEY);
  expect(d.allowForwarding).not.toHaveBeenCalled();
  expect(d.enrollKey).not.toHaveBeenCalled();
});

test("a failure carries the step so the UI can resume there", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 619n), allowForwarding: jest.fn(async () => { throw new Error("User canceled the operation."); }) });
  const err = await runEnable(d, 100_000_000n, () => {}).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EnableError);
  expect((err as EnableError).step).toBe(3);
  expect((err as EnableError).message).toBe("User canceled the operation.");
  expect(d.enrollKey).not.toHaveBeenCalled();
});

test("createAccount that leaves no account on-chain is a step-2 failure", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 0n) });
  const err = await runEnable(d, 100_000_000n, () => {}).catch((e: unknown) => e);
  expect((err as EnableError).step).toBe(2);
  expect(d.createAccount).toHaveBeenCalledTimes(1);
});

test("retry after a step-4 failure does not create the account twice", async () => {
  const enroll = jest.fn(async (): Promise<TradingKey> => { throw new Error("Perpl rejected the enrolment (500)."); });
  const d = deps({ readAccountId: jest.fn(async () => 0n).mockResolvedValueOnce(0n).mockResolvedValue(619n), enrollKey: enroll });
  await expect(runEnable(d, 100_000_000n, () => {})).rejects.toBeInstanceOf(EnableError);
  enroll.mockResolvedValue(KEY);
  await expect(runEnable(d, 100_000_000n, () => {})).resolves.toEqual(KEY);
  expect(d.createAccount).toHaveBeenCalledTimes(1);
  expect(d.allowForwarding).toHaveBeenCalledTimes(2); // sin getter: se reenvía (ruling 5)
});

test("fresh wallet below the amount fails at step 1 with the wallet copy", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 0n), walletAusd: jest.fn(async () => 50_000_000n) });
  const err = await runEnable(d, 100_000_000n, () => {}).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EnableError);
  expect((err as EnableError).step).toBe(1);
  expect((err as EnableError).message).toBe("That is more than the AUSD in your wallet.");
  expect(d.approve).not.toHaveBeenCalled();
  expect(d.createAccount).not.toHaveBeenCalled();
});

test("retry after a step-3 failure with the wallet drained does not re-check the wallet", async () => {
  // Tras createAccount el AUSD ya está en el exchange: la wallet queda en 0 y el retry no debe morir en el paso 1.
  const allow = jest.fn(async () => {}).mockRejectedValueOnce(new Error("User canceled the operation."));
  const d = deps({ readAccountId: jest.fn(async () => 619n), walletAusd: jest.fn(async () => 0n), allowForwarding: allow });
  const err = await runEnable(d, 100_000_000n, () => {}).catch((e: unknown) => e);
  expect((err as EnableError).step).toBe(3);
  await expect(runEnable(d, 100_000_000n, () => {})).resolves.toEqual(KEY);
  expect(d.walletAusd).not.toHaveBeenCalled();
  expect(d.approve).not.toHaveBeenCalled();
});
