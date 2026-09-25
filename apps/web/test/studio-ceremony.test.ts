import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runCeremony,
  type CeremonyDeps,
  type CeremonyProgress,
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
  /** Whether the existing wallet's rules were approved before the earlier attempt stopped. */
  existingApproved?: boolean;
  failPolicies?: boolean;
  /** How many times each fails before it succeeds. */
  createFailures?: number;
  runFailures?: number;
  /** The prompt the person closes, by activity name. */
  closeStamp?: string;
};

function fakes(options: Options = {}) {
  const log: string[] = [];
  let prompts = 0;
  let createFailures = options.createFailures ?? 0;
  let runFailures = options.runFailures ?? 0;
  /* What each prepare handed out, so every confirm can hold the signed request against it. */
  const prepared = new Map<string, UnsignedActivity>();
  const handOut = (name: string) => {
    const activity = unsigned(name);
    prepared.set(name, activity);
    return activity;
  };
  const sameBytes = (name: string, signed: SignedActivity) => {
    const original = prepared.get(name);
    assert.ok(original, `${name} was confirmed without being prepared`);
    assert.equal(signed.body, original.body);
    assert.equal(signed.url, original.url);
  };
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
      if (options.closeStamp && activity.url.endsWith(options.closeStamp)) {
        throw new DOMException("The prompt was closed", "NotAllowedError");
      }
      log.push(`stamp ${activity.url.split("/").pop()}`);
      return {
        url: activity.url,
        body: activity.body,
        stamp: { stampHeaderName: "X-Stamp-WebAuthn", stampHeaderValue: "signed" },
      };
    },
    prepareDelegated: async () => {
      log.push("prepareDelegated");
      return handOut("delegated");
    },
    confirmDelegated: async (signed) => {
      sameBytes("delegated", signed);
      log.push("confirmDelegated");
    },
    prepareWallet: async (handle) => {
      log.push(`prepareWallet ${handle}`);
      if (options.existing) {
        return {
          existing: {
            walletId: "w-old",
            address: "0xold",
            policiesApproved: options.existingApproved ?? false,
          },
        };
      }
      return handOut("wallet");
    },
    confirmWallet: async (handle, signed) => {
      sameBytes("wallet", signed);
      log.push(`confirmWallet ${handle}`);
      return { walletId: "w1", address: "0xabc" };
    },
    preparePolicies: async (walletId) => {
      log.push(`preparePolicies ${walletId}`);
      return handOut("policies");
    },
    confirmPolicies: async (walletId, signed) => {
      sameBytes("policies", signed);
      log.push(`confirmPolicies ${walletId}`);
      if (options.failPolicies) {
        throw new Error("policies refused");
      }
      return { policyIds: ["p1", "p2"] };
    },
    createAgent: async (walletId) => {
      log.push(`createAgent ${walletId}`);
      if (createFailures > 0) {
        createFailures -= 1;
        throw new Error("UNFUNDED_AGENT");
      }
      return { id: "agent-1" };
    },
    startRun: async (agentId) => {
      log.push(`startRun ${agentId}`);
      if (runFailures > 0) {
        runFailures -= 1;
        throw new Error("ADMISSIONS_PAUSED");
      }
      return { runId: "run-1" };
    },
    onStep: (step, state) => {
      log.push(`${step}:${state}`);
    },
  };
  return {
    deps,
    log,
    prompts: () => prompts,
    /** Forgets the calls so far, so a retry's log reads on its own. */
    reset: () => {
      log.length = 0;
      prompts = 0;
    },
  };
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

test("a reused wallet whose rules were approved asks for no passkey and writes no rules again", async () => {
  const { deps, log, prompts } = fakes({
    hasSubOrganization: true,
    hasDelegatedUser: true,
    existing: true,
    existingApproved: true,
  });
  const progress: CeremonyProgress = {};

  await runCeremony(deps, "halftime", progress);

  assert.equal(prompts(), 0);
  assert.deepEqual(calls(log), [
    "state",
    "prepareWallet halftime",
    "createAgent w-old",
    "startRun agent-1",
  ]);
  assert.deepEqual(
    log.filter((line) => line.endsWith(":done")),
    ["wallet:done", "rules:done", "agent:done", "run:done"],
  );
  assert.equal(progress.policiesApproved, true);
});

test("a reused wallet whose rules were not approved still asks for them", async () => {
  const { deps, prompts } = fakes({
    hasSubOrganization: true,
    hasDelegatedUser: true,
    existing: true,
    existingApproved: false,
  });

  await runCeremony(deps, "halftime");

  assert.equal(prompts(), 1);
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

const calls = (log: string[]) => log.filter((line) => !line.includes(":"));

test("a run that failed to start is retried alone: no wallet, no rules, no prompts", async () => {
  const { deps, log, prompts, reset } = fakes({ runFailures: 1 });
  const progress: CeremonyProgress = {};
  await assert.rejects(runCeremony(deps, "halftime", progress), /ADMISSIONS_PAUSED/);
  reset();

  await runCeremony(deps, "halftime", progress);

  assert.deepEqual(calls(log), ["startRun agent-1"]);
  assert.equal(prompts(), 0);
});

test("an agent that failed to be created is retried without the wallet or its rules", async () => {
  const { deps, log, prompts, reset } = fakes({ createFailures: 1 });
  const progress: CeremonyProgress = {};
  await assert.rejects(runCeremony(deps, "halftime", progress), /UNFUNDED_AGENT/);
  reset();

  await runCeremony(deps, "halftime", progress);

  assert.deepEqual(calls(log), ["createAgent w1", "startRun agent-1"]);
  assert.equal(prompts(), 0);
});

test("a retry still reports every step done, in order, for the rail", async () => {
  const { deps, log, reset } = fakes({ runFailures: 1 });
  const progress: CeremonyProgress = {};
  await assert.rejects(runCeremony(deps, "halftime", progress));
  reset();

  await runCeremony(deps, "halftime", progress);

  assert.deepEqual(
    log.filter((line) => line.endsWith(":done")),
    ["wallet:done", "rules:done", "agent:done", "run:done"],
  );
});

test("a closed prompt propagates and progress keeps what was already done", async () => {
  const { deps } = fakes({
    hasSubOrganization: true,
    hasDelegatedUser: true,
    closeStamp: "policies",
  });
  const progress: CeremonyProgress = {};

  await assert.rejects(runCeremony(deps, "halftime", progress), { name: "NotAllowedError" });

  assert.deepEqual(progress, { walletId: "w1", address: "0xabc" });
});

test("an aborted ceremony asks for no passkey at all", async () => {
  const { deps, prompts } = fakes();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(runCeremony(deps, "halftime", {}, controller.signal));

  assert.equal(prompts(), 0);
});

test("an abort between steps stops before the next prompt", async () => {
  const { deps, log, prompts } = fakes({ hasSubOrganization: true, hasDelegatedUser: true });
  const controller = new AbortController();
  const onStep = deps.onStep;
  deps.onStep = (step, state) => {
    onStep(step, state);
    if (step === "wallet" && state === "done") {
      controller.abort();
    }
  };

  await assert.rejects(runCeremony(deps, "halftime", {}, controller.signal));

  assert.equal(prompts(), 1);
  assert.equal(log.includes("preparePolicies w1"), false);
});
