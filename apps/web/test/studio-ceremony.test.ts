import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runCeremony,
  type CeremonyDeps,
  type SignedActivity,
  type UnsignedActivity,
} from "../src/features/studio/create/ceremony";

/* The order "Create and run it once" asks for passkeys in, pinned with fakes. Every fake records
   its call in one log, so an assertion reads the whole sequence rather than one call's presence. */

const unsigned = (name: string): UnsignedActivity => ({
  url: `https://api.turnkey.com/${name}`,
  body: `{"type":"${name}"}`,
  timestampMs: "1",
  organizationId: "sub-org",
});

type Options = {
  hasSubOrganization?: boolean;
  hasDelegatedUser?: boolean;
  existing?: boolean;
  failPolicies?: boolean;
};

function fakes(options: Options = {}) {
  const log: string[] = [];
  let prompts = 0;
  const deps: CeremonyDeps = {
    state: async () => {
      log.push("state");
      return {
        hasSubOrganization: options.hasSubOrganization ?? false,
        hasDelegatedUser: options.hasDelegatedUser ?? false,
      };
    },
    register: async () => {
      prompts += 1;
      log.push("register");
    },
    stamp: async (activity): Promise<SignedActivity> => {
      prompts += 1;
      log.push(`stamp ${activity.url.split("/").pop()}`);
      return {
        url: activity.url,
        body: activity.body,
        stamp: { stampHeaderName: "X-Stamp-WebAuthn", stampHeaderValue: "signed" },
      };
    },
    prepareDelegated: async () => {
      log.push("prepareDelegated");
      return unsigned("delegated");
    },
    confirmDelegated: async () => {
      log.push("confirmDelegated");
    },
    prepareWallet: async (handle) => {
      log.push(`prepareWallet ${handle}`);
      if (options.existing) {
        return { existing: { walletId: "w-old", address: "0xold" } };
      }
      return unsigned("wallet");
    },
    confirmWallet: async (handle) => {
      log.push(`confirmWallet ${handle}`);
      return { walletId: "w1", address: "0xabc" };
    },
    preparePolicies: async (walletId) => {
      log.push(`preparePolicies ${walletId}`);
      return unsigned("policies");
    },
    confirmPolicies: async (walletId) => {
      log.push(`confirmPolicies ${walletId}`);
      if (options.failPolicies) {
        throw new Error("policies refused");
      }
      return { policyIds: ["p1", "p2"] };
    },
    createAgent: async (walletId) => {
      log.push(`createAgent ${walletId}`);
      return { id: "agent-1" };
    },
    startRun: async (agentId) => {
      log.push(`startRun ${agentId}`);
      return { runId: "run-1" };
    },
    onStep: (step, state) => {
      log.push(`${step}:${state}`);
    },
  };
  return { deps, log, prompts: () => prompts };
}

test("the four steps start and finish in order: wallet, rules, agent, run", async () => {
  const { deps, log } = fakes();

  await runCeremony(deps, "halftime");

  assert.deepEqual(
    log.filter((line) => line.includes(":")),
    [
      "wallet:start",
      "wallet:done",
      "rules:start",
      "rules:done",
      "agent:start",
      "agent:done",
      "run:start",
      "run:done",
    ],
  );
});

test("a first agent registers, adds the delegated user, then stamps the wallet and its rules", async () => {
  const { deps, log } = fakes();

  await runCeremony(deps, "halftime");

  assert.deepEqual(log, [
    "wallet:start",
    "state",
    "register",
    "prepareDelegated",
    "stamp delegated",
    "confirmDelegated",
    "prepareWallet halftime",
    "stamp wallet",
    "confirmWallet halftime",
    "wallet:done",
    "rules:start",
    "preparePolicies w1",
    "stamp policies",
    "confirmPolicies w1",
    "rules:done",
    "agent:start",
    "createAgent w1",
    "agent:done",
    "run:start",
    "startRun agent-1",
    "run:done",
  ]);
});

test("the result carries the agent, its run and the wallet's address", async () => {
  const { deps } = fakes();

  const result = await runCeremony(deps, "halftime");

  assert.deepEqual(result, { agentId: "agent-1", runId: "run-1", address: "0xabc" });
});

test("with a sub-organization and a delegated user, neither is created again", async () => {
  const { deps, log } = fakes({ hasSubOrganization: true, hasDelegatedUser: true });

  await runCeremony(deps, "halftime");

  assert.equal(log.includes("register"), false);
  assert.equal(log.includes("prepareDelegated"), false);
});

test("a sub-organization without its delegated user still gets one", async () => {
  const { deps, log } = fakes({ hasSubOrganization: true, hasDelegatedUser: false });

  await runCeremony(deps, "halftime");

  assert.equal(log.includes("register"), false);
  assert.equal(log.includes("confirmDelegated"), true);
});

test("a wallet left by an earlier attempt is reused without a prompt", async () => {
  const { deps, log } = fakes({ hasSubOrganization: true, hasDelegatedUser: true, existing: true });

  await runCeremony(deps, "halftime");

  assert.equal(log.includes("stamp wallet"), false);
  assert.equal(log.includes("confirmWallet halftime"), false);
  assert.equal(log.includes("preparePolicies w-old"), true);
});

test("the reused wallet's address is the one the result names", async () => {
  const { deps } = fakes({ hasSubOrganization: true, hasDelegatedUser: true, existing: true });

  const result = await runCeremony(deps, "halftime");

  assert.equal(result.address, "0xold");
});

test("onWallet hears the wallet before the wallet step is done", async () => {
  const { deps, log } = fakes();
  deps.onWallet = (wallet) => {
    log.push(`onWallet ${wallet.address}`);
  };

  await runCeremony(deps, "halftime");

  assert.equal(log.indexOf("onWallet 0xabc"), log.indexOf("wallet:done") - 1);
});

test("refused policies propagate and nothing is created after them", async () => {
  const { deps, log } = fakes({ failPolicies: true });

  await assert.rejects(runCeremony(deps, "halftime"), /policies refused/);

  assert.equal(log.includes("rules:done"), false);
  assert.equal(
    log.some((line) => line.startsWith("createAgent")),
    false,
  );
  assert.equal(
    log.some((line) => line.startsWith("startRun")),
    false,
  );
});

test("a first agent asks for four passkey prompts", async () => {
  const { deps, prompts } = fakes();

  await runCeremony(deps, "halftime");

  assert.equal(prompts(), 4);
});

test("every later agent asks for two", async () => {
  const { deps, prompts } = fakes({ hasSubOrganization: true, hasDelegatedUser: true });

  await runCeremony(deps, "halftime");

  assert.equal(prompts(), 2);
});
