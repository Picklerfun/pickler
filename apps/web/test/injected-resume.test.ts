import test from "node:test";
import assert from "node:assert/strict";
import { injectedSigner } from "../src/features/wallet/lib/injected-signer";
import { boundedWalletRead, type Eip1193Provider } from "../src/features/wallet/lib/provider";

const address = "0x" + "5".repeat(40);
function browser() {
  const target = new EventTarget() as EventTarget & { ethereum?: Eip1193Provider };
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  return target;
}
function provider(calls: string[], accounts: string[] = [address]): Eip1193Provider {
  return {
    async request({ method }) {
      calls.push(method);
      if (method === "eth_accounts") {
        return accounts;
      }
      if (method === "eth_chainId") {
        return "0x279f";
      }
      if (method === "eth_getBalance") {
        return "0x1";
      }
      throw new Error("Prompting is forbidden: " + method);
    },
  };
}

test("reload resumes an authorized extension even when it injects after hydration", async () => {
  const target = browser();
  const calls: string[] = [];
  const pending = injectedSigner.resume();
  target.ethereum = provider(calls);
  target.dispatchEvent(new Event("ethereum#initialized"));

  assert.deepEqual(await pending, { address, chainId: 10143, balance: 1n });
  assert.deepEqual(calls.sort(), ["eth_accounts", "eth_chainId", "eth_getBalance"].sort());
});

test("late injection without an initialized event is still resumed silently", async () => {
  const target = browser();
  const pending = injectedSigner.resume();
  target.ethereum = provider([]);

  assert.equal((await pending)?.address, address);
});

test("a locked or revoked extension never requests account access automatically", async () => {
  const target = browser();
  const calls: string[] = [];
  target.ethereum = provider(calls, []);

  assert.equal(await injectedSigner.resume(), null);
  assert.deepEqual(calls, ["eth_accounts"]);
});

test("cancelled restoration cannot pick up a later provider", async () => {
  const target = browser();
  const controller = new AbortController();
  const pending = injectedSigner.resume(controller.signal);
  controller.abort();
  target.ethereum = provider([]);
  target.dispatchEvent(new Event("ethereum#initialized"));

  assert.equal(await pending, null);
});

test("unreachable read returns unknown and consumes a late provider rejection", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<bigint>((_resolve, fail) => {
    reject = fail;
  });

  assert.equal(await boundedWalletRead<bigint | null>(pending, null, undefined, 5), null);
  reject(new Error("late failure"));
});

test("a slow balance cannot delay or resurrect an account change", async () => {
  const target = browser();
  const listeners = new Map<string, (...args: never[]) => void>();
  let release!: (value: string) => void;
  let balanceCalls = 0;
  target.ethereum = {
    ...provider([]),
    on: (event, listener) => {
      listeners.set(event, listener);
    },
    removeListener: (event) => {
      listeners.delete(event);
    },
    async request({ method }) {
      if (method === "eth_chainId") {
        return "0x279f";
      }
      if (method === "eth_getBalance") {
        if (++balanceCalls === 1) {
          return new Promise<string>((resolve) => {
            release = resolve;
          });
        }
        return "0x1";
      }
      return [address];
    },
  };
  const changes: unknown[] = [];
  const stop = injectedSigner.subscribe!((account) => changes.push(account));
  listeners.get("accountsChanged")!([address] as never);
  listeners.get("accountsChanged")!([] as never);
  await new Promise((resolve) => setTimeout(resolve, 0));
  release("0x1");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(changes, [null]);
  stop();
  assert.equal(listeners.size, 0);
});
