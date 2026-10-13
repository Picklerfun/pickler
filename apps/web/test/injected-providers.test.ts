import test from "node:test";
import assert from "node:assert/strict";
import {
  getProvider,
  switchToTarget,
  type Eip1193Provider,
} from "../src/features/wallet/lib/provider";
import {
  injectedWalletSnapshot,
  selectInjectedWallet,
  subscribeInjectedWallets,
} from "../src/features/wallet/lib/injected-providers";
import { walletFailure, WalletRequestError } from "../src/features/wallet/lib/wallet-request-error";

function browser(stored?: string) {
  const data = new Map(stored ? [["pk.wallet.provider", stored]] : []);
  const target = new EventTarget() as EventTarget & {
    ethereum?: Eip1193Provider;
    localStorage: unknown;
  };
  target.localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  return target;
}
function announce(target: EventTarget, rdns: string, name: string, provider: Eip1193Provider) {
  const event = new Event("eip6963:announceProvider");
  Object.defineProperty(event, "detail", { value: { info: { rdns, name }, provider } });
  target.dispatchEvent(event);
}
const inert: Eip1193Provider = {
  request: async () => {
    throw new Error("No wallet call is allowed during discovery");
  },
};

test("Rabby selection stays pinned when MetaMask overwrites window.ethereum", () => {
  const target = browser();
  const metamask = { ...inert, isMetaMask: true };
  const rabby = { ...inert, isRabby: true };
  target.ethereum = metamask;
  let notifications = 0;
  const stop = subscribeInjectedWallets(() => {
    notifications += 1;
  });
  announce(target, "io.rabby", "Rabby", rabby);
  announce(target, "io.metamask", "MetaMask", metamask);
  announce(target, "io.rabby", "Rabby", rabby);

  assert.equal(injectedWalletSnapshot().length, 2);
  selectInjectedWallet("io.rabby");
  target.ethereum = metamask;

  assert.equal(getProvider(), rabby);
  assert.equal(notifications, 1);
  stop();
});

test("a missing remembered Rabby never restores MetaMask instead", () => {
  const target = browser("io.rabby");
  const metamask = { ...inert, isMetaMask: true };
  target.ethereum = metamask;

  assert.equal(getProvider(), null);
  announce(target, "io.rabby", "Rabby", inert);
  assert.equal(getProvider(), inert);
});

test("network add is followed by another switch and verified without chainChanged", async () => {
  const calls: string[] = [];
  let switches = 0;
  let chain = "0x1";
  const wallet: Eip1193Provider = {
    async request({ method }) {
      calls.push(method);
      if (method === "wallet_switchEthereumChain") {
        switches += 1;
        if (switches === 1) {
          throw { code: -32603, data: { originalError: { code: 4902 } } };
        }
        chain = "0x279f";
      } else if (method === "eth_chainId") {
        return chain;
      } else {
        assert.equal(method, "wallet_addEthereumChain");
        assert.equal(chain, "0x1", "adding must not be mistaken for switching");
      }
      return null;
    },
  };

  assert.equal(await switchToTarget(wallet), true);
  assert.deepEqual(calls, [
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
});

test("a successful RPC response on the wrong network is not reported as a successful switch", async () => {
  const wallet: Eip1193Provider = {
    request: async ({ method }) => (method === "eth_chainId" ? "0x1" : null),
  };
  await assert.rejects(
    () => switchToTarget(wallet),
    (error) =>
      error instanceof WalletRequestError && error.failure.title === "Check your wallet network",
  );
});

test("nested wallet errors retain useful causes but never render provider payloads", () => {
  const cancelled = walletFailure(
    { code: -32603, data: { originalError: { code: "4001", message: "rejected" } } },
    "eth_sendTransaction",
  );
  assert.equal(cancelled.code, 4001);
  assert.equal(cancelled.title, "Request cancelled");
  const pending = walletFailure({ code: -32002 }, "wallet_switchEthereumChain");
  assert.match(pending.detail, /pending request/);
  const insufficient = walletFailure(
    {
      code: -32603,
      data: { originalError: { code: -32000, message: "insufficient funds for gas" } },
    },
    "eth_call",
  );
  assert.equal(insufficient.title, "Not enough MON for gas");
  const secret = "private authorization payload";
  const unknown = walletFailure(
    { code: -32603, message: secret, data: { transaction: secret } },
    "eth_call",
  );
  assert.ok(!JSON.stringify(unknown).includes(secret));
});
