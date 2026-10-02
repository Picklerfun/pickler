// apps/web/test/studio-new-agent-ceremony.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NoSubOrganization,
  createAgent,
  createWallet,
  type CreateDeps,
  type WalletDeps,
} from "../src/features/studio/new-agent/ceremony";

const unsigned = (name: string) => ({
  url: name,
  body: name,
  timestampMs: "1",
  organizationId: "sub",
});
const signed = (u: { url: string; body: string }) => ({
  ...u,
  stamp: { stampHeaderName: "X-Stamp", stampHeaderValue: "s" },
});

function walletDeps(state: { delegated: boolean; existing?: boolean }) {
  const calls: string[] = [];
  const deps: WalletDeps = {
    state: async () => ({ hasSubOrganization: true, hasDelegatedUser: state.delegated }),
    stamp: async (u) => {
      calls.push(`stamp:${u.url}`);
      return signed(u);
    },
    prepareWallet: async () =>
      state.existing
        ? { existing: { walletId: "w", address: "0x1", policiesApproved: false } }
        : unsigned("wallet"),
    confirmWallet: async () => ({ walletId: "w", address: "0x1" }),
    prepareDelegated: async () => unsigned("delegated"),
    confirmDelegated: async () => {
      calls.push("delegated");
    },
    onStep: (step) => calls.push(`step:${step}`),
  };
  return { deps, calls };
}

test("the first wallet is two stamps: the wallet, then the delegated user", async () => {
  const { deps, calls } = walletDeps({ delegated: false });
  await createWallet(deps);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("stamp:")),
    ["stamp:wallet", "stamp:delegated"],
  );
});

test("a later wallet is one stamp", async () => {
  const { deps, calls } = walletDeps({ delegated: true });
  await createWallet(deps);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("stamp:")),
    ["stamp:wallet"],
  );
});

test("a wallet an earlier attempt left is reused without a stamp, and step 2 still runs", async () => {
  const { deps, calls } = walletDeps({ delegated: false, existing: true });
  await createWallet(deps);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("stamp:")),
    ["stamp:delegated"],
  );
});

test("the steps are announced as 1 then 2", async () => {
  const { deps, calls } = walletDeps({ delegated: false });
  await createWallet(deps);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("step:")),
    ["step:1", "step:2"],
  );
});

test("a reused wallet goes straight to step 2", async () => {
  const { deps, calls } = walletDeps({ delegated: false, existing: true });
  await createWallet(deps);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("step:")),
    ["step:2"],
  );
});

test("step 2 waits for the second Continue after step 1 prompted", async () => {
  const { deps, calls } = walletDeps({ delegated: false });
  deps.beforeStep2 = async () => {
    calls.push("continue");
  };
  await createWallet(deps);
  assert.deepEqual(calls, [
    "step:1",
    "stamp:wallet",
    "step:2",
    "continue",
    "stamp:delegated",
    "delegated",
  ]);
});

test("a step 2 that is not continued keeps the wallet and stamps nothing more", async () => {
  const { deps, calls } = walletDeps({ delegated: false });
  deps.beforeStep2 = async () => {
    throw Object.assign(new Error("closed"), { name: "AbortError" });
  };
  await assert.rejects(createWallet(deps), { name: "AbortError" });
  assert.deepEqual(
    calls.filter((call) => call.startsWith("stamp:")),
    ["stamp:wallet"],
  );
});

test("a reused wallet's step 2 needs no second Continue: the press that started it counts", async () => {
  const { deps } = walletDeps({ delegated: false, existing: true });
  deps.beforeStep2 = async () => {
    throw new Error("must not wait");
  };
  await createWallet(deps);
});

test("create signs the policies, then creates the draft", async () => {
  const calls: string[] = [];
  const deps: CreateDeps = {
    stamp: async (u) => {
      calls.push(`stamp:${u.url}`);
      return signed(u);
    },
    preparePolicies: async () => unsigned("policies"),
    confirmPolicies: async () => {
      calls.push("confirmed");
      return { policyIds: ["a", "b", "c"] };
    },
    createDraft: async () => {
      calls.push("draft");
      return { productId: "p" };
    },
  };
  const result = await createAgent(deps, { walletId: "w", policiesApproved: false });
  assert.deepEqual(calls, ["stamp:policies", "confirmed", "draft"]);
  assert.equal(result.productId, "p");
});

test("create skips the stamp when the policies were already approved", async () => {
  const calls: string[] = [];
  const deps: CreateDeps = {
    stamp: async () => {
      calls.push("stamp");
      throw new Error("no");
    },
    preparePolicies: async () => unsigned("policies"),
    confirmPolicies: async () => ({ policyIds: [] }),
    createDraft: async () => {
      calls.push("draft");
      return { productId: "p" };
    },
  };
  await createAgent(deps, { walletId: "w", policiesApproved: true });
  assert.deepEqual(calls, ["draft"]);
});

test("a cancelled stamp stops before the draft", async () => {
  const deps: CreateDeps = {
    stamp: async () => {
      throw Object.assign(new Error("closed"), { name: "NotAllowedError" });
    },
    preparePolicies: async () => unsigned("policies"),
    confirmPolicies: async () => ({ policyIds: [] }),
    createDraft: async () => {
      throw new Error("must not run");
    },
  };
  await assert.rejects(createAgent(deps, { walletId: "w", policiesApproved: false }), {
    name: "NotAllowedError",
  });
});

test("no sub-organization throws before any stamp", async () => {
  const { deps, calls } = walletDeps({ delegated: false });
  deps.state = async () => ({ hasSubOrganization: false, hasDelegatedUser: false });

  await assert.rejects(createWallet(deps), NoSubOrganization);

  assert.deepEqual(calls, []);
});

test("a cancelled policies stamp never confirms them", async () => {
  const calls: string[] = [];
  const deps: CreateDeps = {
    stamp: async () => {
      throw Object.assign(new Error("closed"), { name: "NotAllowedError" });
    },
    preparePolicies: async () => unsigned("policies"),
    confirmPolicies: async () => {
      calls.push("confirmed");
      return { policyIds: [] };
    },
    createDraft: async () => ({ productId: "p" }),
  };

  await assert.rejects(createAgent(deps, { walletId: "w", policiesApproved: false }));

  assert.deepEqual(calls, []);
});

test("a step 2 closed on the device after the wallet was made rejects, with the wallet confirmed", async () => {
  const { deps, calls } = walletDeps({ delegated: false });
  let confirmed = false;
  deps.confirmWallet = async () => {
    confirmed = true;
    return { walletId: "w", address: "0x1" };
  };
  const stampOnce = deps.stamp;
  deps.stamp = async (u) => {
    if (u.url === "delegated") {
      throw Object.assign(new Error("closed"), { name: "NotAllowedError" });
    }
    return stampOnce(u);
  };

  await assert.rejects(createWallet(deps), { name: "NotAllowedError" });

  assert.equal(confirmed, true);
  assert.equal(calls.includes("delegated"), false);
});
