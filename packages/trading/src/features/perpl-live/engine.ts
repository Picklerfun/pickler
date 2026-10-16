import {
  PilotError,
  InvalidSignedActivityError,
  SignedActivityRejectedError,
  type SignedActivityRequest,
} from "@pickler/core";
import type {
  PerplLiveDocument,
  PerplLiveExistingKey,
  PerplLiveDriver,
  PerplLiveRepository,
  PerplLiveScope,
  PerplLiveSettings,
} from "./contracts.js";
import { assertLiveAuthority } from "./policy.js";

export function emptyPerplLiveDocument(address: string, productAgentId: string): PerplLiveDocument {
  return {
    productAgentId,
    version: 1,
    address,
    accountId: null,
    publicKey: null,
    encryptedKey: null,
    encryptedToken: null,
    keyExpiresAt: null,
    nextRequestId: 0,
    setup: [],
    sessions: [],
    orders: [],
    snapshot: null,
    lease: null,
  };
}
export function createPerplLiveService(deps: {
  repository: PerplLiveRepository;
  driver: PerplLiveDriver;
  admissions: boolean;
  setupAdmissions?: boolean;
  randomId: () => string;
}) {
  const repo = deps.repository;
  async function state(scope: PerplLiveScope) {
    const value = await repo.read(scope);
    const requirements = (await deps.driver.requirements?.().catch(() => null)) ?? null;
    return {
      ...value,
      available: true,
      admissionsEnabled: deps.admissions,
      setupAdmissionsEnabled:
        (deps.setupAdmissions ?? deps.admissions) &&
        value.document?.connection?.kind !== "key_wallet",
      requirements,
    };
  }
  async function connectExistingKey(scope: PerplLiveScope, input: PerplLiveExistingKey) {
    if (!deps.driver.connectExistingKey) {
      throw new PilotError("PERPL_UNAVAILABLE", "Existing Perpl keys are not supported");
    }
    if (
      !/^[\x21-\x7e]{1,2048}$/.test(input.apiKey) ||
      !/^(?:0x)?[a-f\d]{64}$/i.test(input.privateKeyHex)
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        "A Perpl API token and 32-byte Ed25519 key are required",
      );
    }
    const original = await repo.inspectKeyChange(scope, {});
    // Authentication uses reads only. No provider request runs under the repository lock.
    const connected = await deps.driver.connectExistingKey(
      original.authority,
      original.document,
      input,
      original.validUntil,
    );
    await repo.connectKey(scope, {
      original,
      connected,
      useKeyWallet: input.useKeyWallet ?? false,
    });
    return state(scope);
  }
  async function prepareSetup(scope: PerplLiveScope, amountMicros: string, key: string) {
    if (!(deps.setupAdmissions ?? deps.admissions)) {
      throw new PilotError("PERPL_ADMISSIONS_PAUSED", "Perpl account preparation is disabled");
    }
    const reserved = await repo.reserveSetup(scope, { amountMicros, key, id: deps.randomId() });
    if (!reserved.fresh) {
      return reserved.setup;
    }
    try {
      const prepared = await deps.driver.prepareSetup(
        reserved.authority,
        reserved.document,
        amountMicros,
      );
      return await repo.completePreparation(scope, {
        setupId: reserved.setup.id,
        prepared,
        amountMicros,
      });
    } catch (error) {
      await repo.failPreparation(scope, {
        setupId: reserved.setup.id,
        errorCode: error instanceof PilotError ? error.code : "PERPL_SETUP_UNAVAILABLE",
      });
      throw error instanceof PilotError
        ? error
        : new PilotError("PERPL_SETUP_UNAVAILABLE", "Could not prepare Perpl");
    }
  }
  async function confirmSetup(scope: PerplLiveScope, id: string, signed: SignedActivityRequest) {
    const claim = await repo.claimSetup(scope, {
      id,
      admissions: deps.admissions,
      setupAdmissions: deps.setupAdmissions ?? deps.admissions,
    });
    if (!claim.fresh) {
      return claim.setup;
    }
    const guard = async () => {
      const { authority, document } = await repo.read(scope);
      assertLiveAuthority(authority, true);
      if (document?.setup.find((s) => s.id === id)?.status !== "signing") {
        throw new PilotError("CONFLICT", "Signing claim no longer holds");
      }
    };
    try {
      const result = await deps.driver.confirmSetup(
        claim.authority,
        claim.document,
        claim.setup,
        signed,
        guard,
        async (change) => {
          await repo.progressSetup(scope, { id, change });
        },
      );
      return await repo.completeSetup(scope, { id, result });
    } catch (error) {
      return repo.rejectSetup(scope, {
        id,
        rejected:
          error instanceof InvalidSignedActivityError ||
          error instanceof SignedActivityRejectedError,
      });
    }
  }
  async function start(scope: PerplLiveScope, settings: PerplLiveSettings, key: string) {
    if (!deps.admissions) {
      throw new PilotError("PERPL_ADMISSIONS_PAUSED", "Trading admissions are disabled");
    }
    return repo.startSession(scope, { settings, key, id: deps.randomId() });
  }
  async function control(scope: PerplLiveScope, action: "pause" | "resume" | "stop" | "close") {
    return repo.controlSession(scope, { action, admissions: deps.admissions });
  }
  async function tick(scope: PerplLiveScope) {
    const owner = deps.randomId();
    const claim = await repo.claimLease(scope, { owner });
    if (!claim) {
      return;
    }
    const guard = async (increasing: boolean) => {
      await repo.renewLease(scope, { owner, increasing, admissions: deps.admissions });
    };
    try {
      for (const setup of claim.document.setup.filter(
        (s) => (s.txHash || s.activityId) && ["submitted", "unknown"].includes(s.status),
      )) {
        const result = await deps.driver.reconcileSetup(
          claim.authority,
          claim.document,
          setup,
          async () => {
            await guard(false);
            const { authority } = await repo.read(scope);
            assertLiveAuthority(authority, true);
            if (!(deps.setupAdmissions ?? deps.admissions)) {
              throw new PilotError("PERPL_ADMISSIONS_PAUSED", "Account changes are disabled");
            }
          },
          async (change) => {
            await repo.progressReconciliation(scope, { owner, setupId: setup.id, change });
          },
        );
        if (result.confirmed || result.failed || result.txHash) {
          await repo.completeReconciliation(scope, { owner, setupId: setup.id, result });
        }
      }
      if (!claim.document.encryptedToken) {
        return;
      }
      const snapshot = await deps.driver.snapshot(claim.authority, claim.document);
      const verified = new Set<string>();
      const alreadyVerified = new Set(
        await repo.verifiedTransactions(
          scope,
          snapshot.orders.map((o) => o.requestId),
        ),
      );
      for (const hash of new Set(snapshot.orders.flatMap((o) => o.txHashes))) {
        if (alreadyVerified.has(hash)) {
          verified.add(hash);
          continue;
        }
        if (await deps.driver.verifyTransaction(hash)) {
          verified.add(hash);
        }
      }
      const prepared = await repo.reserveOrder(scope, {
        owner,
        snapshot,
        verified: [...verified],
        admissions: deps.admissions,
        id: deps.randomId(),
      });
      if (!prepared) {
        return;
      }
      const increasing = prepared.order.request.t <= 2;
      await guard(increasing);
      const head = deps.driver.executionHead
        ? await deps.driver.executionHead(prepared.document)
        : snapshot.head;
      prepared.order.request = await repo.beginDispatch(scope, {
        owner,
        increasing,
        head,
        snapshotHead: snapshot.head,
        orderId: prepared.order.id,
      });
      let status: "accepted" | "rejected" | "unknown" = "unknown";
      try {
        status = await deps.driver.submit(prepared.document, prepared.order.request, () =>
          guard(increasing),
        );
      } finally {
        await repo.completeDispatch(scope, { owner, orderId: prepared.order.id, status });
      }
    } catch (error) {
      await repo.failTick(scope, {
        owner,
        errorCode: error instanceof PilotError ? error.code : "PERPL_SYNC_UNAVAILABLE",
      });
    } finally {
      await repo.releaseLease(scope, { owner });
    }
  }
  return {
    state,
    prepareSetup,
    connectExistingKey,
    confirmSetup,
    start,
    control,
    tick,
    async tickDue() {
      let again = false;
      for (const scope of await repo.due(10)) {
        await tick(scope);
        const { document } = await repo.read(scope);
        if (document?.sessions.some((session) => ["active", "stopping"].includes(session.status))) {
          again = true;
        }
      }
      return again;
    },
  };
}
