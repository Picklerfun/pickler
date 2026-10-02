// Ported from Relayer apps/api/src/kits/signing/passkeys/passkey.service.ts (commit bb6bb1226e92).
// Changed: the challenge store is a port over Postgres rather than Redis, and the caller is a
// Supabase user rather than an integrator.

import {
  ADD_PASSKEY_ACTIVITY_TYPE,
  AGENT_WALLET_ACTIVITY_TYPES,
  AgentWalletNotFoundError,
  AgentWalletLinkedError,
  ChallengeNotUsableError,
  DelegatedKeyNotConfiguredError,
  DelegatedUserExistsError,
  DelegatedUserMissingError,
  MONAD_ACCOUNT_PATH,
  NoCustodyAccountError,
  deviceTypeFromTransports,
} from "../domain/passkey.js";
import {
  agentWalletPolicies,
  delegatedSelfDeletePolicy,
  MIN_AGENT_WALLET_POLICIES,
} from "../domain/agent-wallet-policies.js";
import {
  DepositAlreadyRecordedError,
  DepositFeeTooHighError,
  DepositNonceError,
  DepositsUnavailableError,
  InsufficientFundsError,
  InsufficientGasError,
  InvalidDepositAmountError,
  InvalidTransferError,
  isDepositAmount,
  MAX_DEPOSIT_GAS,
  MAX_FEE_MULTIPLE,
  MAX_NATIVE_TRANSFER_GAS,
  TransferAlreadyRecordedError,
} from "../domain/deposit.js";
import { fundingShortfall, readFunding, WalletUnderfundedError } from "../../studio/create.js";
import type { ChallengeOptions, DisplayIdentity, PasskeyAttestation } from "../domain/passkey.js";
import type {
  AddPasskeyActivityBuilder,
  AgentWallet,
  ExistingAgentWallet,
  AgentWalletActivityBuilders,
  AgentWalletRepository,
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  DepositChain,
  SubOrganizationCreator,
  UnsignedActivity,
  WalletBalanceReader,
} from "../ports/custody.js";
import type { SignedActivityForwarder } from "../../signing/ports/signing.js";
import {
  COMPLETED_ACTIVITY_STATUS,
  InvalidSignedActivityError,
  isTerminalActivity,
  SignedActivityRejectedError,
  SigningServiceUnavailableError,
} from "../../signing/domain/turnkey-activity.js";
import type {
  SignedActivityRequest,
  TurnkeyActivity,
} from "../../signing/domain/turnkey-activity.js";

const CHALLENGE_TTL_MS = 300_000;

/**
 * The activity's result under `key`, or a failure that says why there is none. Unlike
 * add-passkey, every step of the agent ceremony has something to record from its result, so a
 * status short of completed is an error rather than a response: a failed or rejected activity is
 * Turnkey's refusal (400), and one still pending after the forwarder's polling is a service that
 * did not finish in time (502) — the person retries and the orphan path picks the wallet up.
 */
function completedResult(activity: TurnkeyActivity, key: string): Record<string, unknown> {
  if (activity.status !== COMPLETED_ACTIVITY_STATUS) {
    if (isTerminalActivity(activity.status)) {
      throw new SignedActivityRejectedError(
        activity.failure?.message ?? `The activity did not complete (${activity.status})`,
      );
    }
    throw new SigningServiceUnavailableError(`Activity ${activity.id} is still ${activity.status}`);
  }
  const result = activity.result?.[key];
  if (!result) {
    throw new SigningServiceUnavailableError(`Completed activity carried no ${key}`);
  }
  return result;
}

const TIMESTAMP = /^\d+$/;

/**
 * Refuses a stamped request that is not, byte for byte, the one Pickler would have prepared.
 *
 * Confirm is stateless, so the expectation is rebuilt: the stamped body's own `timestampMs` is
 * read (it must be digits), the same builder is called with the same inputs and that timestamp,
 * and the URL and body must then be identical strings. Comparing bytes rather than parsed JSON is
 * the point: a body with a key twice (`"publicKey": ours, "publicKey": theirs`) parses to one
 * value here and may be read as the other by Turnkey, and only an exact comparison closes that.
 *
 * Without this, a person's browser could stamp different parameters (another public key, a second
 * user, an extra ALLOW) and Pickler would record the ids it got back as the ones it prepared.
 */
function assertStampedAsPrepared(
  signed: SignedActivityRequest,
  rebuild: (timestampMs: string) => UnsignedActivity,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signed.body);
  } catch {
    throw new InvalidSignedActivityError("Signed body is not valid JSON");
  }
  const timestampMs =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)["timestampMs"]
      : undefined;
  if (typeof timestampMs !== "string" || !TIMESTAMP.test(timestampMs)) {
    throw new InvalidSignedActivityError("Signed body carries no valid timestampMs");
  }
  const expected = rebuild(timestampMs);
  if (signed.url !== expected.url || signed.body !== expected.body) {
    throw new InvalidSignedActivityError("The signed activity is not the one Pickler prepared");
  }
}

/**
 * The `unsignedTransaction` a stamped sign_transaction body carries. Only read to be checked:
 * the byte comparison afterwards proves it is the one the rest of the body was built around.
 */
function stampedUnsignedTransaction(signed: SignedActivityRequest): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signed.body);
  } catch {
    throw new InvalidSignedActivityError("Signed body is not valid JSON");
  }
  const parameters =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)["parameters"]
      : undefined;
  const unsignedTransaction =
    parameters && typeof parameters === "object" && !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>)["unsignedTransaction"]
      : undefined;
  if (typeof unsignedTransaction !== "string" || !unsignedTransaction) {
    throw new InvalidSignedActivityError("Signed body carries no unsignedTransaction");
  }
  return unsignedTransaction;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry)) {
    return [];
  }
  return value as string[];
}

/** A move of AUSD or MON between the person's master wallet and one of their agent wallets. */
export interface TransferRequest {
  /** "master", or one of the person's agent wallet ids. Exactly one side is "master". */
  from: string;
  to: string;
  token: "AUSD" | "MON";
  /** Base units: micro-AUSD or wei. */
  amount: bigint;
}

/** Saved by `saveTransfer`, and reported as it would have been saved when that fails. */
type TransferRecord = Parameters<AgentWalletRepository["saveTransfer"]>[0];

export interface CustodyServiceDeps {
  challenges: ChallengeStore;
  repository: CustodyRepository;
  turnkey: SubOrganizationCreator;
  activities: AddPasskeyActivityBuilder;
  forwarder: SignedActivityForwarder;
  /** The agent wallet ceremony: unsigned bodies and where their results are recorded. */
  agentActivities: AgentWalletActivityBuilders;
  agentWallets: AgentWalletRepository;
  /**
   * Pickler's delegated API public key (compressed P-256 hex), or null where it is not
   * configured — then no delegated user can be created and the ceremony stops at its first step.
   */
  delegatedPublicKey: string | null;
  /**
   * AUSD on the configured chain, for deposits from the master wallet to an agent's. Absent where
   * the chain is not composed; deposits then answer `DepositsUnavailableError`.
   */
  deposits?: DepositChain;
  /**
   * MON and AUSD balances read from the chain, uncached. Absent where the chain is not composed;
   * transfers, the wallet list and the policies step then answer `DepositsUnavailableError`.
   */
  balances?: WalletBalanceReader;
  /** Contracts the delegated user may sign to; core's VENUE_CONTRACTS, empty until trading. */
  venueContracts: readonly string[];
  rpId: string;
  appName: string;
  now: () => Date;
  randomId: () => string;
  /**
   * Called when a registration mints a sub-organization that ends up belonging to nobody, so the
   * caller can log it for out-of-band reconciliation. This package has no side channels, which is
   * why the id has to leave through a dependency rather than a log line here; without it the only
   * record of a real Turnkey organisation Pickler owns and cannot reach was a comment promising
   * that somebody else would deal with it. Synchronous and `void`: a rejected promise from a log
   * sink would surface as an unhandled rejection, and no failure here may change the outcome of
   * the registration it is reporting on.
   */
  reportOrphan?(orphan: { userId: string; subOrganizationId: string }): void;
  /**
   * Called when Turnkey created a delegated user that Pickler then could not record — two
   * confirms raced and the other one's user was saved first. The user exists in the person's
   * sub-organization with no policy naming it; this is the only record of it. Same contract as
   * `reportOrphan`: synchronous, and a failure in it never changes the outcome.
   */
  reportUnrecordedDelegatedUser?(user: {
    userId: string;
    subOrganizationId: string;
    delegatedUserId: string;
  }): void;
  /**
   * Called when a deposit was broadcast but could not be recorded: the AUSD moved and no row says
   * so. Ids and amounts only. Same contract as `reportOrphan`: synchronous, and a failure in it
   * never changes the outcome — the original error is rethrown either way.
   */
  reportUnrecordedDeposit?(deposit: {
    agentId: string;
    txHash: string;
    amountMicroUsd: bigint;
  }): void;
  /** The same for a transfer between the master and an agent wallet. Same contract. */
  reportUnrecordedTransfer?(transfer: TransferRecord): void;
}

export function createCustodyService(deps: CustodyServiceDeps) {
  /** Reporting an orphan must never turn a recovered registration into a failed one. */
  function reportOrphan(userId: string, subOrganizationId: string) {
    try {
      deps.reportOrphan?.({ userId, subOrganizationId });
    } catch {
      // A broken log sink is not worth a 500 to the person who just registered.
    }
  }

  /**
   * Best-effort. A lookup failure must never stop a person registering, so it degrades to
   * no exclusions rather than propagating. Relayer learned this the same way.
   */
  async function excludeCredentials(userId: string) {
    try {
      const existing = await deps.repository.listCredentials(userId);
      if (!existing.length) {
        return undefined;
      }
      return existing.map((c) => ({
        id: c.credentialId,
        type: "public-key" as const,
        ...(c.transports.length ? { transports: c.transports } : {}),
      }));
    } catch {
      // Swallows a bug in the adapter as readily as a transient outage; registering is worth more.
      return undefined;
    }
  }

  /**
   * The policies a wallet gets, decided the same way for prepare and for confirm, and only for an
   * unlinked wallet (`AgentWalletLinkedError` otherwise). For the person's first agent — no wallet
   * of theirs linked to any agent yet, decided here and never by the caller — the delegated user's
   * self-delete policy rides along.
   */
  async function policiesFor(userId: string, walletId: string) {
    const delegatedUserId = await deps.agentWallets.delegatedUserId(userId);
    if (!delegatedUserId) {
      throw new DelegatedUserMissingError();
    }
    const wallet = await deps.agentWallets.findOwnedAgentWallet(userId, walletId);
    if (!wallet) {
      throw new AgentWalletNotFoundError();
    }
    // A linked wallet's rules were approved and linked at create; never a second set.
    if (wallet.linked) {
      throw new AgentWalletLinkedError();
    }
    const policies = agentWalletPolicies({
      delegatedUserId,
      walletId,
      venueContracts: deps.venueContracts,
    });
    if (!(await deps.agentWallets.hasLinkedAgentWallet(userId))) {
      policies.push(delegatedSelfDeletePolicy(delegatedUserId));
    }
    return { policies, wallet };
  }

  /**
   * "Agent wallet N", from the wallets recorded: prepare and confirm each derive it, so a confirm
   * rebuilds the body its prepare built. Another wallet recorded in between (a second tab's
   * ceremony) moves N, and the stale stamp is then refused before anything reaches Turnkey —
   * which is the wanted outcome: that person already has an unlinked wallet for a fresh prepare
   * to resume, and a second one would be minted for nothing. Two confirms racing past the count
   * together can both be "Agent wallet N"; the name is a label, so that costs nothing but a
   * duplicate label.
   */
  async function nextWalletName(userId: string): Promise<string> {
    return `Agent wallet ${(await deps.agentWallets.countAgentWallets(userId)) + 1}`;
  }

  /**
   * What every deposit step needs, refused in the same order for prepare and confirm: a listed
   * amount, a composed chain, the person's master wallet, and the agent's wallet — which must be
   * one of this person's own, whatever the caller already checked about the agent.
   */
  async function depositContext(userId: string, agentId: string, amountAusd: number) {
    if (!isDepositAmount(amountAusd)) {
      throw new InvalidDepositAmountError();
    }
    const chain = deps.deposits;
    if (!chain) {
      throw new DepositsUnavailableError();
    }
    const account = await deps.repository.findByUserId(userId);
    if (!account) {
      throw new NoCustodyAccountError();
    }
    const linked = await deps.agentWallets.findAgentWallet(agentId);
    const wallet = linked
      ? await deps.agentWallets.findOwnedAgentWallet(userId, linked.walletId)
      : null;
    if (!wallet) {
      throw new AgentWalletNotFoundError();
    }
    return {
      chain,
      account,
      wallet,
      baseUnits: BigInt(amountAusd) * 10n ** BigInt(chain.decimals),
      amountMicroUsd: BigInt(amountAusd) * 1_000_000n,
    };
  }

  /**
   * Who a transfer is between, refused in the same order for prepare and confirm: AUSD or MON,
   * wallet ids as strings, a positive amount, exactly one side the master, a composed AUSD chain,
   * the person's master wallet (`turnkey_orgs.master_wallet_id`), and the other side one of this
   * person's own `kind='agent'` wallets — never a wallet id taken on trust, and never the master's
   * own id. Balances are not read here: only prepare checks them (`assertCanSend`).
   */
  async function transferParties(userId: string, request: TransferRequest) {
    if (request.token !== "AUSD" && request.token !== "MON") {
      throw new InvalidTransferError("A transfer moves AUSD or MON");
    }
    if (typeof request.from !== "string" || typeof request.to !== "string") {
      throw new InvalidTransferError("A transfer names its wallets");
    }
    if (typeof request.amount !== "bigint" || request.amount <= 0n) {
      throw new InvalidTransferError("The amount must be more than zero");
    }
    if ((request.from === "master") === (request.to === "master")) {
      throw new InvalidTransferError(
        "A transfer goes between the master wallet and one agent wallet",
      );
    }
    const chain = deps.deposits;
    // AUSD amounts are micro-AUSD: a token of any other precision would move the wrong amount.
    if (!chain || chain.decimals !== 6) {
      throw new DepositsUnavailableError();
    }
    const account = await deps.repository.findByUserId(userId);
    if (!account) {
      throw new NoCustodyAccountError();
    }
    const agentWalletId = request.from === "master" ? request.to : request.from;
    const agent = await deps.agentWallets.findOwnedAgentWallet(userId, agentWalletId);
    if (!agent) {
      throw new AgentWalletNotFoundError();
    }
    const master = { walletId: account.masterWalletId, address: account.address };
    const source = request.from === "master" ? master : agent;
    const target = request.from === "master" ? agent : master;
    return { chain, account, source, target };
  }

  /**
   * Prepare only, so the person learns before stamping: the source holds the amount and, from the
   * transaction just built, the MON its fee can reach (gas limit × max fee, plus the amount for a
   * MON transfer). Confirm does not read balances again: the chain refuses an overdraft, and a
   * repeated confirm must reach its recorded-hash check whatever the balance is by then.
   */
  function assertCanSend(
    chain: DepositChain,
    held: { monWei: bigint | null; ausdMicro: bigint | null },
    request: TransferRequest,
    unsignedTransaction: string,
  ): void {
    const built =
      request.token === "AUSD"
        ? chain.inspectTransfer(unsignedTransaction)
        : chain.inspectNativeTransfer(unsignedTransaction);
    if (!built) {
      throw new Error("The chain built a transfer it cannot read back");
    }
    const fee = built.gas * built.maxFeePerGas;
    const monNeeded = request.token === "MON" ? request.amount + fee : fee;
    if (held.monWei === null || held.monWei < monNeeded) {
      throw new InsufficientGasError();
    }
  }

  /**
   * Fees move between prepare and confirm, so they are checked against a fresh quote rather than
   * rebuilt: a stamped fee far above it is one nobody prepared, and it burns MON. Above the
   * signer's pending nonce is a gap: it would sit queued behind a transaction nobody sent. At or
   * below it flows on: a repeated confirm of a sent transfer is found by its hash afterwards
   * (409), or the node already holds it and it is recorded, or the node refuses it.
   *
   * An agent wallet's nonce is live: its agent may send from it between a pull-back's prepare and
   * confirm, and the node then refuses the stamped nonce as too low; the person prepares again.
   */
  async function checkFeesAndNonce(
    chain: DepositChain,
    transfer: { nonce: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
    signer: string,
  ): Promise<void> {
    const quote = await chain.quoteFees();
    if (
      transfer.maxFeePerGas > quote.maxFeePerGas * MAX_FEE_MULTIPLE ||
      transfer.maxPriorityFeePerGas > quote.maxPriorityFeePerGas * MAX_FEE_MULTIPLE
    ) {
      throw new DepositFeeTooHighError();
    }
    if (transfer.nonce > (await chain.pendingNonce(signer))) {
      throw new DepositNonceError();
    }
  }

  /**
   * The checks every stamped transfer passes before anything is sent, shared by deposits and
   * transfers. The stamped transaction cannot be rebuilt (the nonce and fees have moved since
   * prepare), so what it does is read back and checked instead — this chain, a bounded gas limit,
   * exactly this amount to exactly this recipient, and for AUSD this token and no native value —
   * and then the whole activity is rebuilt around it and compared byte for byte, so nothing else
   * in the body (the signer above all) differs from what prepare built. Only then is it
   * forwarded, and what Turnkey signed is checked against what the passkey approved.
   */
  async function checkStampedTransfer(input: {
    chain: DepositChain;
    subOrganizationId: string;
    signer: string;
    recipient: string;
    token: "AUSD" | "MON";
    amount: bigint;
    signed: SignedActivityRequest;
  }): Promise<{ signedTransaction: string }> {
    const { chain } = input;
    const unsignedTransaction = stampedUnsignedTransaction(input.signed);
    if (input.token === "AUSD") {
      const transfer = chain.inspectTransfer(unsignedTransaction);
      if (!transfer) {
        throw new InvalidSignedActivityError("The stamped transaction is not a token transfer");
      }
      if (transfer.chainId !== chain.chainId) {
        throw new InvalidSignedActivityError("The stamped transaction is for another chain");
      }
      if (!sameAddress(transfer.to, chain.token)) {
        throw new InvalidSignedActivityError("The stamped transaction moves another token");
      }
      if (transfer.value !== 0n) {
        throw new InvalidSignedActivityError("The stamped transaction sends native value");
      }
      if (transfer.gas > MAX_DEPOSIT_GAS) {
        throw new InvalidSignedActivityError("The stamped transaction reserves too much gas");
      }
      if (!sameAddress(transfer.recipient, input.recipient)) {
        throw new InvalidSignedActivityError("The stamped transaction pays another wallet");
      }
      if (transfer.amount !== input.amount) {
        throw new InvalidSignedActivityError("The stamped transaction moves another amount");
      }
      await checkFeesAndNonce(chain, transfer, input.signer);
    } else {
      const transfer = chain.inspectNativeTransfer(unsignedTransaction);
      if (!transfer) {
        throw new InvalidSignedActivityError("The stamped transaction is not a plain transfer");
      }
      if (transfer.chainId !== chain.chainId) {
        throw new InvalidSignedActivityError("The stamped transaction is for another chain");
      }
      if (transfer.gas > MAX_NATIVE_TRANSFER_GAS) {
        throw new InvalidSignedActivityError("The stamped transaction reserves too much gas");
      }
      if (!sameAddress(transfer.to, input.recipient)) {
        throw new InvalidSignedActivityError("The stamped transaction pays another wallet");
      }
      if (transfer.value !== input.amount) {
        throw new InvalidSignedActivityError("The stamped transaction moves another amount");
      }
      await checkFeesAndNonce(chain, transfer, input.signer);
    }
    assertStampedAsPrepared(input.signed, (timestampMs) =>
      deps.agentActivities.signTransaction({
        subOrganizationId: input.subOrganizationId,
        signWith: input.signer,
        unsignedTransaction,
        timestampMs,
      }),
    );
    const activity = await deps.forwarder.forward(input.signed, {
      organizationId: input.subOrganizationId,
      allowedActivityTypes: [AGENT_WALLET_ACTIVITY_TYPES.signTransaction],
    });
    const signedTransaction = completedResult(activity, "signTransactionResult")[
      "signedTransaction"
    ];
    if (typeof signedTransaction !== "string" || !signedTransaction) {
      throw new SigningServiceUnavailableError("Completed activity carried no signed transaction");
    }
    // What Turnkey signed must be what the passkey approved, signed by the source wallet.
    await chain.verifySignedTransfer({
      signedTransaction,
      unsignedTransaction,
      signer: input.signer,
    });
    return { signedTransaction };
  }

  return {
    async issueChallenge(userId: string, identity: DisplayIdentity): Promise<ChallengeOptions> {
      const challenge = deps.randomId();
      await deps.challenges.put(challenge, {
        userId,
        expiresAt: new Date(deps.now().getTime() + CHALLENGE_TTL_MS),
      });
      const exclude = await excludeCredentials(userId);
      return {
        challenge,
        rp: { id: deps.rpId, name: deps.appName },
        // The WebAuthn user handle, a separate opaque value from the challenge above.
        user: { id: deps.randomId(), name: identity.name, displayName: identity.displayName },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        timeout: CHALLENGE_TTL_MS,
        attestation: "none",
        ...(exclude ? { excludeCredentials: exclude } : {}),
      };
    },

    /**
     * Idempotent by design. Relayer's version minted a second sub-organization on every retry
     * from a stale tab, which broke the single-row lookup and returned the person to the passkey
     * screen for ever. The pre-check handles the ordinary retry; `created: false` handles the
     * concurrent submit that races past it.
     */
    async register(
      userId: string,
      input: {
        /**
         * The Turnkey root user's name, and the sub-organization's. Not the challenge's
         * `DisplayIdentity`, which may carry the person's email for their keychain: this goes to
         * Turnkey, and email is kept out of Turnkey.
         */
        ownerLabel: string;
        label: string;
        challenge: string;
        attestation: PasskeyAttestation;
      },
    ): Promise<CustodyAccount> {
      const existing = await deps.repository.findByUserId(userId);
      if (existing) {
        return existing;
      }

      // A challenge is spent by the act of looking at it: consume deletes as it reads, and
      // ownership is judged on the record below. A claim that turns out to belong to someone else
      // is deliberately NOT put back. Restoring it would leave a challenge that survives probing
      // and open a window in which the same one is claimed twice.
      const claimed = await deps.challenges.consume(input.challenge);
      if (!claimed || claimed.userId !== userId || claimed.expiresAt <= deps.now()) {
        throw new ChallengeNotUsableError();
      }

      const created = await deps.turnkey.create({
        ownerLabel: input.ownerLabel,
        discriminator: userId.slice(0, 8),
        label: input.label,
        challenge: input.challenge,
        attestation: input.attestation,
      });

      const saved = await deps.repository.saveRegistration({
        userId,
        subOrganizationId: created.subOrganizationId,
        masterWalletId: created.walletId,
        rootUserId: created.rootUserId,
        walletId: created.walletId,
        address: created.address,
        credentialId: input.attestation.credentialId,
        label: input.label,
        transports: input.attestation.transports,
        deviceType: deviceTypeFromTransports(input.attestation.transports),
      });

      if (saved.created) {
        return {
          userId,
          subOrganizationId: created.subOrganizationId,
          masterWalletId: created.walletId,
          rootUserId: created.rootUserId,
          address: created.address,
        };
      }

      // Lost the race. The winner's sub-organization is the real one; ours is an orphan in
      // Turnkey, reported here for out-of-band reconciliation. Both exits report it: the throw
      // below carries the id in its message, but that message is replaced with "Internal server
      // error" outside local development, so on the rarer path it would otherwise be lost.
      reportOrphan(userId, created.subOrganizationId);
      const winner = await deps.repository.findByUserId(userId);
      if (!winner) {
        throw new Error(
          `Registration conflicted but no account is readable for ${userId}; orphan sub-org ${created.subOrganizationId}`,
        );
      }
      return winner;
    },

    /**
     * The new device creates its own credential first; this builds the CREATE_AUTHENTICATORS
     * activity that adds it, which an existing passkey then stamps. Relayer numbers the same
     * two steps "create" and "verify" in its add-passkey modal.
     */
    async prepareAddPasskey(
      userId: string,
      input: { label: string; challenge: string; attestation: PasskeyAttestation },
    ): Promise<UnsignedActivity> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const claimed = await deps.challenges.consume(input.challenge);
      if (!claimed || claimed.userId !== userId || claimed.expiresAt <= deps.now()) {
        throw new ChallengeNotUsableError();
      }
      return deps.activities.build({
        subOrganizationId: account.subOrganizationId,
        rootUserId: account.rootUserId,
        label: input.label,
        challenge: input.challenge,
        attestation: input.attestation,
      });
    },

    async confirmAddPasskey(
      userId: string,
      input: {
        label: string;
        credentialId: string;
        transports: string[];
        signed: SignedActivityRequest;
      },
    ) {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const activity = await deps.forwarder.forward(input.signed, {
        organizationId: account.subOrganizationId,
        allowedActivityTypes: [ADD_PASSKEY_ACTIVITY_TYPE],
      });
      if (activity.status === COMPLETED_ACTIVITY_STATUS) {
        await deps.repository.addPasskey({
          userId,
          credentialId: input.credentialId,
          label: input.label,
          transports: input.transports,
          deviceType: deviceTypeFromTransports(input.transports),
        });
      }
      return activity;
    },

    /** What the browser needs to know to decide which steps of the ceremony to run. */
    async agentWalletState(userId: string) {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        return { hasSubOrganization: false, hasDelegatedUser: false };
      }
      const delegated = await deps.agentWallets.delegatedUserId(userId);
      return { hasSubOrganization: true, hasDelegatedUser: delegated !== null };
    },

    /** Step one, once per sub-organization: Pickler's non-root user, created by the person. */
    async prepareDelegatedUser(userId: string): Promise<UnsignedActivity> {
      if (!deps.delegatedPublicKey) {
        throw new DelegatedKeyNotConfiguredError();
      }
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      if ((await deps.agentWallets.delegatedUserId(userId)) !== null) {
        throw new DelegatedUserExistsError();
      }
      return deps.agentActivities.createDelegatedUser({
        subOrganizationId: account.subOrganizationId,
        publicKey: deps.delegatedPublicKey,
      });
    },

    async confirmDelegatedUser(
      userId: string,
      signed: SignedActivityRequest,
    ): Promise<{ delegatedUserId: string }> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const publicKey = deps.delegatedPublicKey;
      if (!publicKey) {
        throw new DelegatedKeyNotConfiguredError();
      }
      // Refused before anything reaches Turnkey: a second create_users would leave a second
      // Pickler user in the person's sub-organization that nothing records.
      if ((await deps.agentWallets.delegatedUserId(userId)) !== null) {
        throw new DelegatedUserExistsError();
      }
      assertStampedAsPrepared(signed, (timestampMs) =>
        deps.agentActivities.createDelegatedUser({
          subOrganizationId: account.subOrganizationId,
          publicKey,
          timestampMs,
        }),
      );
      const activity = await deps.forwarder.forward(signed, {
        organizationId: account.subOrganizationId,
        allowedActivityTypes: [AGENT_WALLET_ACTIVITY_TYPES.createDelegatedUser],
      });
      const [delegatedUserId, ...extra] = strings(
        completedResult(activity, "createUsersResult").userIds,
      );
      if (!delegatedUserId || extra.length > 0) {
        throw new SigningServiceUnavailableError("Expected exactly one user from create_users");
      }
      try {
        await deps.agentWallets.saveDelegatedUser(userId, delegatedUserId);
      } catch (error) {
        if (error instanceof DelegatedUserExistsError) {
          // Lost a race after the check above: Turnkey has this user and Pickler cannot record
          // it. Say so before refusing, or its only trace is in Turnkey's dashboard.
          try {
            deps.reportUnrecordedDelegatedUser?.({
              userId,
              subOrganizationId: account.subOrganizationId,
              delegatedUserId,
            });
          } catch {
            // A broken log sink changes nothing about the refusal.
          }
        }
        throw error;
      }
      return { delegatedUserId };
    },

    /**
     * Step two. An agent wallet of the person's that no agent is linked to is the retry of a
     * creation that stopped before its link: the newest one is returned as it is, so a second
     * attempt never leaves a second wallet in the person's sub-organization. It says whether that
     * wallet's rules were approved too — at least `MIN_AGENT_WALLET_POLICIES` recorded ids, the
     * same floor the link requires — so a retry after a reload does not ask the passkey to write
     * them again. A new wallet is "Agent wallet N" (`nextWalletName`).
     */
    async prepareAgentWallet(
      userId: string,
    ): Promise<{ existing: ExistingAgentWallet } | { unsigned: UnsignedActivity }> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const orphan = await deps.agentWallets.findUnlinkedWallet(userId);
      if (orphan) {
        return {
          existing: {
            walletId: orphan.walletId,
            address: orphan.address,
            policiesApproved: (orphan.approvedPolicyIds?.length ?? 0) >= MIN_AGENT_WALLET_POLICIES,
          },
        };
      }
      return {
        unsigned: deps.agentActivities.createAgentWallet({
          subOrganizationId: account.subOrganizationId,
          name: await nextWalletName(userId),
        }),
      };
    },

    async confirmAgentWallet(userId: string, signed: SignedActivityRequest): Promise<AgentWallet> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const name = await nextWalletName(userId);
      assertStampedAsPrepared(signed, (timestampMs) =>
        deps.agentActivities.createAgentWallet({
          subOrganizationId: account.subOrganizationId,
          name,
          timestampMs,
        }),
      );
      const activity = await deps.forwarder.forward(signed, {
        organizationId: account.subOrganizationId,
        allowedActivityTypes: [AGENT_WALLET_ACTIVITY_TYPES.createAgentWallet],
      });
      const result = completedResult(activity, "createWalletResult");
      const walletId = typeof result.walletId === "string" ? result.walletId : "";
      const [address] = strings(result.addresses);
      if (!walletId || !address) {
        throw new SigningServiceUnavailableError("Agent wallet was not returned");
      }
      await deps.agentWallets.saveWallet({
        userId,
        walletId,
        subOrganizationId: account.subOrganizationId,
        kind: "agent",
        name,
        address,
        path: MONAD_ACCOUNT_PATH,
      });
      return { walletId, address };
    },

    /**
     * Step three: the wallet's rules. For the person's first agent — no wallet of theirs linked
     * to any agent yet, decided here and never by the caller — the delegated user's self-delete
     * policy rides along; it belongs to the sub-organization and is written once. They are not
     * prepared until the wallet holds the minimums to start (`WalletUnderfundedError`); a chain
     * that cannot be read is `BalancesUnreadableError`, never underfunded. `confirmPolicies` does not check again: the stamp is already made, and refusing it would
     * strand an approved policy set. The drafts route checks again.
     */
    async preparePolicies(userId: string, walletId: string): Promise<UnsignedActivity> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const { policies, wallet } = await policiesFor(userId, walletId);
      const balances = deps.balances;
      if (!balances) {
        throw new DepositsUnavailableError();
      }
      const shortfall = fundingShortfall(await readFunding(() => balances.read(wallet.address)));
      if (shortfall) {
        throw new WalletUnderfundedError(shortfall);
      }
      return deps.agentActivities.createPolicies({
        subOrganizationId: account.subOrganizationId,
        policies,
      });
    },

    /**
     * Returns the ids the link records: exactly one per policy prepared. Any other count means
     * Turnkey created something other than what the person approved, and a wallet whose rules
     * cannot be accounted for is not one an agent may have.
     */
    async confirmPolicies(
      userId: string,
      walletId: string,
      signed: SignedActivityRequest,
    ): Promise<{ policyIds: string[] }> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const { policies } = await policiesFor(userId, walletId);
      assertStampedAsPrepared(signed, (timestampMs) =>
        deps.agentActivities.createPolicies({
          subOrganizationId: account.subOrganizationId,
          policies,
          timestampMs,
        }),
      );
      const activity = await deps.forwarder.forward(signed, {
        organizationId: account.subOrganizationId,
        allowedActivityTypes: [AGENT_WALLET_ACTIVITY_TYPES.createPolicies],
      });
      const policyIds = strings(completedResult(activity, "createPoliciesResult").policyIds);
      if (policyIds.length !== policies.length) {
        throw new SigningServiceUnavailableError(
          `Expected ${policies.length} policies to be created, got ${policyIds.length}`,
        );
      }
      // The server is the only source of which rules a wallet carries: record what Turnkey
      // actually created here, so a later agent creation reads this instead of trusting whatever
      // the client sends.
      await deps.agentWallets.saveApprovedPolicies(userId, walletId, policyIds);
      return { policyIds };
    },

    /**
     * Funding an agent, step one: the unsigned transfer from the master wallet to the agent's,
     * wrapped in the sign_transaction activity the passkey stamps. The unsigned transaction
     * travels inside the activity and comes back with the stamp; nothing is kept here, because
     * its nonce and fees cannot be derived again at confirm.
     */
    async prepareDeposit(
      userId: string,
      agentId: string,
      amountAusd: number,
    ): Promise<UnsignedActivity & { amountMicroUsd: bigint }> {
      const context = await depositContext(userId, agentId, amountAusd);
      const unsignedTransaction = await context.chain.prepareTransfer({
        from: context.account.address,
        to: context.wallet.address,
        amount: context.baseUnits,
      });
      const unsigned = deps.agentActivities.signTransaction({
        subOrganizationId: context.account.subOrganizationId,
        signWith: context.account.address,
        unsignedTransaction,
      });
      return { ...unsigned, amountMicroUsd: context.amountMicroUsd };
    },

    /**
     * Step two. The stamped transfer passes `checkStampedTransfer` — the master as signer, this
     * agent's wallet as recipient, exactly this amount of AUSD — and is forwarded there. Only then
     * is it broadcast and recorded. A broadcast that fails records nothing.
     */
    async confirmDeposit(
      userId: string,
      agentId: string,
      amountAusd: number,
      signed: SignedActivityRequest,
    ): Promise<{ txHash: string }> {
      const context = await depositContext(userId, agentId, amountAusd);
      const { chain, account, wallet } = context;
      const { signedTransaction } = await checkStampedTransfer({
        chain,
        subOrganizationId: account.subOrganizationId,
        signer: account.address,
        recipient: wallet.address,
        token: "AUSD",
        amount: context.baseUnits,
        signed,
      });
      // A repeated confirm of the same stamp: already sent and recorded, so nothing is sent again.
      if (await deps.agentWallets.depositRecorded(chain.transactionHash(signedTransaction))) {
        throw new DepositAlreadyRecordedError();
      }
      const txHash = await chain.broadcast(signedTransaction);
      // Sent: whatever happens to the record, the next balance read must see the chain.
      chain.forgetBalance(wallet.address);
      const deposit = { agentId, txHash, amountMicroUsd: context.amountMicroUsd };
      try {
        await deps.agentWallets.saveDeposit(deposit);
      } catch (error) {
        // The AUSD moved and no row says so. A duplicate is not that: its row exists.
        if (!(error instanceof DepositAlreadyRecordedError)) {
          try {
            deps.reportUnrecordedDeposit?.(deposit);
          } catch {
            // A broken log sink changes nothing about the failure.
          }
        }
        throw error;
      }
      return { txHash };
    },

    /**
     * The master wallet and every agent wallet of the person's, each with its balances read now.
     * A balance the chain did not answer is null, never zero.
     */
    async listWallets(userId: string) {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const balances = deps.balances;
      if (!balances) {
        throw new DepositsUnavailableError();
      }
      const agents = await deps.agentWallets.listAgentWallets(userId);
      const [master, ...each] = await Promise.all([
        balances.read(account.address),
        ...agents.map((wallet) => balances.read(wallet.address)),
      ]);
      return {
        master: { address: account.address, ...master! },
        agents: agents.map((wallet, index) => ({ ...wallet, ...each[index]! })),
        readAt: deps.now().getTime(),
      };
    },

    /**
     * One of the person's agent wallets' balances, read from the chain: the drafts route checks
     * them against the minimums again, since the money can have moved since the policies step.
     * A read that fails or answers neither balance is `BalancesUnreadableError`.
     */
    async walletBalance(userId: string, walletId: string) {
      const wallet = await deps.agentWallets.findOwnedAgentWallet(userId, walletId);
      if (!wallet) {
        throw new AgentWalletNotFoundError();
      }
      const balances = deps.balances;
      if (!balances) {
        throw new DepositsUnavailableError();
      }
      return readFunding(() => balances.read(wallet.address));
    },

    /**
     * Moving AUSD or MON between the master wallet and one of the person's agent wallets, step
     * one: the unsigned transaction from the source, wrapped in the sign_transaction activity the
     * passkey stamps with the source as `signWith`. Like a deposit, nothing is kept here.
     */
    async prepareTransfer(userId: string, request: TransferRequest): Promise<UnsignedActivity> {
      const { chain, account, source, target } = await transferParties(userId, request);
      if (!deps.balances) {
        throw new DepositsUnavailableError();
      }
      const held = await deps.balances.read(source.address);
      const available = request.token === "AUSD" ? held.ausdMicro : held.monWei;
      if (available === null || available < request.amount) {
        throw new InsufficientFundsError();
      }
      const move = { from: source.address, to: target.address, amount: request.amount };
      const unsignedTransaction =
        request.token === "AUSD"
          ? await chain.prepareTransfer(move)
          : await chain.prepareNativeTransfer(move);
      assertCanSend(chain, held, request, unsignedTransaction);
      return deps.agentActivities.signTransaction({
        subOrganizationId: account.subOrganizationId,
        signWith: source.address,
        unsignedTransaction,
      });
    },

    /**
     * Step two: the same parties again (ownership re-checked, balances not re-read), the stamped
     * transfer through `checkStampedTransfer`, then the recorded-hash check, the broadcast, both
     * balances forgotten, and the receipt in `wallets.transfers`. A broadcast that fails records
     * nothing; a record that fails after a broadcast is reported, as a deposit's is, and a retry
     * of the same stamp records it (the node already holds the transaction).
     *
     * The recorded-hash check runs after the stamp is forwarded, because the hash exists only once
     * Turnkey has signed. So a repeated confirm creates another SIGN_TRANSACTION activity in
     * Turnkey before it is refused (TRANSFER_ALREADY_RECORDED). Harmless: it signs the same
     * transaction, with the same nonce, and nothing is broadcast twice.
     */
    async confirmTransfer(
      userId: string,
      request: TransferRequest,
      signed: SignedActivityRequest,
    ): Promise<{ txHash: string }> {
      const { chain, account, source, target } = await transferParties(userId, request);
      const { signedTransaction } = await checkStampedTransfer({
        chain,
        subOrganizationId: account.subOrganizationId,
        signer: source.address,
        recipient: target.address,
        token: request.token,
        amount: request.amount,
        signed,
      });
      // A repeated confirm of the same stamp: already sent and recorded, so nothing is sent again.
      if (await deps.agentWallets.transferRecorded(chain.transactionHash(signedTransaction))) {
        throw new TransferAlreadyRecordedError();
      }
      const txHash = await chain.broadcast(signedTransaction);
      // Sent: whatever happens to the record, the next balance reads must see the chain.
      chain.forgetBalance(source.address);
      chain.forgetBalance(target.address);
      const transfer: TransferRecord = {
        userId,
        fromWalletId: source.walletId,
        toWalletId: target.walletId,
        token: request.token === "AUSD" ? "ausd" : "mon",
        amount: request.amount,
        txHash,
      };
      try {
        await deps.agentWallets.saveTransfer(transfer);
      } catch (error) {
        // The funds moved and no row says so. A duplicate is not that: its row exists.
        if (!(error instanceof TransferAlreadyRecordedError)) {
          try {
            deps.reportUnrecordedTransfer?.(transfer);
          } catch {
            // A broken log sink changes nothing about the failure.
          }
        }
        throw error;
      }
      return { txHash };
    },

    getAccount: (userId: string) => deps.repository.findByUserId(userId),

    /**
     * Every passkey on the account, oldest first.
     *
     * Deliberately not wrapped. `excludeCredentials` above catches, because a lookup failure must
     * never stop somebody registering; this one must do the opposite, because its caller is
     * deciding whether to tell a person they can still reach their money after losing a device.
     * A catch here would return an empty list for an unreachable database, and the screen would
     * read that as "no passkeys" — the same silent degradation, moved one layer up.
     */
    listPasskeys: (userId: string) => deps.repository.listPasskeys(userId),
  };
}
