// apps/web/test/studio-new-agent.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AVATAR_PATTERNS,
  MIN_START,
  STARTER_CAPS,
  VOICES,
  canCreate,
  createLabel,
  deriveHandle,
  emptyForm,
  footNote,
  funded,
  handleState,
  parseAmount,
  patternCells,
  toDraftRequest,
  toTransferBody,
  transferLabel,
  walletTag,
  type NewAgentForm,
  type WalletView,
} from "../src/features/studio/new-agent/model";

/* One behaviour per test: these are the rules the create screen is. */

const filled = (patch: Partial<NewAgentForm> = {}): NewAgentForm => ({
  ...emptyForm(),
  name: "Halftime",
  voice: "analyst",
  ...patch,
});
const wallet = (patch: Partial<WalletView> = {}): WalletView => ({
  walletId: "wal",
  address: "0x91be",
  ausdMicro: 10_000_000n,
  monWei: 500_000_000_000_000_000n,
  ...patch,
});

test("the handle follows the name", () => {
  assert.equal(deriveHandle("Half Time!"), "halftime");
});

test("an edited handle wins over the name's", () => {
  assert.equal(deriveHandle("Halftime", "ht_bot"), "ht_bot");
});

test("no name is 'Name it to create'", () => {
  assert.equal(createLabel(emptyForm(), handleState("", null), null), "Name it to create");
});

test("a taken handle says so", () => {
  assert.equal(createLabel(filled(), "taken", wallet()), "@halftime is taken");
});

test("no voice is 'Pick a voice to create'", () => {
  assert.equal(createLabel(filled({ voice: null }), "free", wallet()), "Pick a voice to create");
});

test("no wallet is 'Create its wallet first'", () => {
  assert.equal(createLabel(filled(), "free", null), "Create its wallet first");
});

test("a wallet below either minimum is 'Deposit to create'", () => {
  assert.equal(createLabel(filled(), "free", wallet({ monWei: 0n })), "Deposit to create");
});

test("everything there is 'Create {name}'", () => {
  assert.equal(createLabel(filled(), "free", wallet()), "Create Halftime");
});

test("create opens only with a free handle, a voice and a funded wallet", () => {
  assert.equal(canCreate(filled(), "free", wallet()), true);
  assert.equal(canCreate(filled(), "free", wallet({ ausdMicro: 9_999_999n })), false);
});

test("an unread balance is not funded", () => {
  assert.equal(funded(wallet({ ausdMicro: null })), false);
});

test("the footnote points at the wallet until it is funded", () => {
  assert.equal(footNote(null), "CREATE ITS WALLET FIRST →");
  assert.equal(footNote(wallet({ monWei: 0n })), "FUND ITS WALLET TO CREATE →");
  assert.equal(footNote(wallet()), "ONE PASSKEY");
});

test("the wallet tag: step 0, empty, funded", () => {
  assert.equal(walletTag(null), "STEP 0 · CREATE IT");
  assert.equal(walletTag(wallet({ ausdMicro: 0n })), "CREATED · EMPTY");
  assert.equal(walletTag(wallet()), "FUNDED");
});

test("the request carries the caps, the avatar, the web off as null and the wallet", () => {
  const request = toDraftRequest(filled(), "wal");
  assert.deepEqual(request.caps, { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 });
  assert.deepEqual(request.avatar, { accent: "lime", pattern: 0 });
  assert.equal(request.sources.web, null);
  assert.equal(request.walletId, "wal");
});

test("the web on sends its mode and sites", () => {
  const request = toDraftRequest(filled({ webOn: true, webMode: "only", sites: ["x.com"] }), "wal");
  assert.deepEqual(request.sources.web, { mode: "only", sites: ["x.com"] });
});

test("an amount is parsed to base units: 1.5 AUSD", () => {
  assert.equal(parseAmount("1.5", "AUSD"), 1_500_000n);
});

test("an amount with too many decimals is not an amount", () => {
  assert.equal(parseAmount("0.0000001", "AUSD"), null);
});

test("a transfer label names the token and refuses more than the source holds", () => {
  assert.equal(
    transferLabel({
      amount: "5",
      token: "MON",
      toAgent: true,
      held: 10n ** 18n,
      agentName: "Halftime",
    }),
    "More MON than the master wallet holds",
  );
  assert.equal(
    transferLabel({
      amount: "0.5",
      token: "MON",
      toAgent: true,
      held: 10n ** 18n,
      agentName: "Halftime",
    }),
    "Send 0.5 MON to Halftime",
  );
});

test("a pattern is sixteen cells", () => {
  assert.equal(patternCells(0).length, 16);
});

test("the copies match core's: six voices, six patterns, the starter caps, the minimums", async () => {
  const core = await import("@pickler/core");
  assert.deepEqual(
    VOICES.map((voice) => voice.key),
    core.VOICES.map((voice) => voice.key),
  );
  assert.deepEqual([...AVATAR_PATTERNS], [...core.AVATAR_PATTERNS]);
  assert.deepEqual(STARTER_CAPS, { ...core.STARTER_CAPS });
  assert.equal(MIN_START.ausdMicro, core.MIN_START_MICRO_AUSD);
  assert.equal(MIN_START.monWei, core.MIN_START_MON_WEI);
});

test("a transfer's amount is trimmed before it is sent", () => {
  const body = toTransferBody({ from: "master", to: "wal", token: "MON", amount: " 0.5 " });
  assert.equal(body.amount, "0.5");
});

test("every code creation and transfers can return has a message", async () => {
  const { knownMessage } = await import("../src/features/studio/lib/messages");
  const codes = [
    // POST /v1/studio/drafts
    "WALLET_UNDERFUNDED",
    "WALLET_NOT_FOUND",
    "WALLET_ASSIGNED",
    "POLICIES_MISSING",
    "HANDLE_TAKEN",
    "DRAFT_LIMIT",
    "WALLETS_UNAVAILABLE",
    // /v1/signing policies prepare
    "wallet_underfunded",
    "balances_unavailable",
    // /v1/studio/wallets/transfers
    "INVALID_TRANSFER",
    "INSUFFICIENT_FUNDS",
    "INSUFFICIENT_GAS",
    "TRANSFER_ALREADY_RECORDED",
    "FEE_TOO_HIGH",
    "NONCE_GAP",
    "NOT_SENDABLE",
  ];
  for (const code of codes) {
    assert.ok(knownMessage(code), `${code} has no message`);
  }
});
