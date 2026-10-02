// apps/web/test/studio-new-agent.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AVATAR_PATTERNS,
  MIN_START,
  STARTER_CAPS,
  ACCENT_OPTIONS,
  DEFAULT_BRIEF,
  VOICES,
  arrived,
  balanceNote,
  canCreate,
  capsEdited,
  capsInverted,
  createLabel,
  deriveHandle,
  emptyForm,
  footNote,
  formatUnits,
  lines,
  funded,
  handleState,
  parseAmount,
  patternCells,
  sectionTag,
  sheetCopy,
  step0Copy,
  unlinkedWallet,
  validHandle,
  walletSheetStep,
  toDraftRequest,
  toTransferBody,
  walletOutlined,
  walletTag,
  walletLockNote,
  type NewAgentForm,
  type WalletView,
} from "../src/features/studio/new-agent/model";
import { transferLabel } from "../src/features/studio/new-agent/transfer-model";

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

test("at the draft limit Create is shut before anything else, with the limit as its words", async () => {
  const { DRAFT_LIMIT_NOTE } = await import("../src/features/studio/lib/messages");
  const { draftLimitLock } = await import("../src/features/studio/home/gate");
  const drafts = [1, 2, 3].map((n) => ({
    id: `d${n}`,
    productId: `d${n}`,
    name: `Draft ${n}`,
    draft: true,
    wallet: null,
    canCreateAnother: { ok: true, reason: null },
  }));
  const note = draftLimitLock(drafts);

  assert.equal(note, DRAFT_LIMIT_NOTE);
  assert.equal(createLabel(filled(), "free", wallet(), note), "At most 3 drafts at a time.");
  assert.equal(canCreate(filled(), "free", wallet(), note), false);
  assert.equal(createLabel(emptyForm(), handleState("", null), null, note), note);
  assert.equal(canCreate(filled(), "free", wallet(), ""), true);
  // The wallet step says why it is shut, not Create's words.
  assert.equal(walletLockNote(note), "You're at the draft limit; open or delete a draft first.");
  assert.equal(walletLockNote(""), "");
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
    VOICES.map(({ key, name, sample }) => ({ key, name, sample })),
    core.VOICES.map(({ key, name, sample }) => ({ key, name, sample })),
  );
  assert.deepEqual([...ACCENT_OPTIONS].sort(), [...core.ACCENTS].sort());
  assert.equal(DEFAULT_BRIEF.thesis, core.DEFAULT_BRIEF.thesis);
  assert.deepEqual(lines(DEFAULT_BRIEF.enters), [...core.DEFAULT_BRIEF.entersWhen]);
  assert.deepEqual(lines(DEFAULT_BRIEF.exits), [...core.DEFAULT_BRIEF.exitsWhen]);
  assert.deepEqual(lines(DEFAULT_BRIEF.never), [...core.DEFAULT_BRIEF.never]);
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
    "SIGNED_TX_MISMATCH",
    // Either family's passkey and backend failures
    "INVALID_SIGNED_ACTIVITY",
    "SIGNED_ACTIVITY_REJECTED",
    "SIGNING_UNAVAILABLE",
    "NO_CUSTODY_ACCOUNT",
    "INTERNAL_OR_PROVIDER_FAILURE",
    "INVALID_INPUT",
    "UNFUNDED_AGENT",
  ];
  for (const code of codes) {
    assert.ok(knownMessage(code), `${code} has no message`);
  }
});

test("a name that reads like a label does not open create without a wallet", () => {
  assert.equal(canCreate(filled({ name: "its wallet first" }), "free", null), false);
});

test("units keep the digits they show: 1.00005 AUSD is 1", () => {
  assert.equal(formatUnits(1_000_050n, "AUSD"), "1");
});

test("units below the shown precision read as 0", () => {
  assert.equal(formatUnits(1n, "MON"), "0");
});

test("units keep their significant decimals", () => {
  assert.equal(formatUnits(1_500_000n, "AUSD"), "1.5");
});

test("a draft needs a voice", () => {
  assert.throws(() => toDraftRequest(filled({ voice: null }), "wal"));
});

test("a transfer label trims the amount", () => {
  const label = transferLabel({
    amount: " 0.5 ",
    token: "MON",
    toAgent: true,
    held: 10n ** 18n,
    agentName: "Halftime",
  });
  assert.equal(label, "Send 0.5 MON to Halftime");
});

test("an unread balance is 'Reading the balance…'", () => {
  const label = transferLabel({
    amount: "1",
    token: "AUSD",
    toAgent: false,
    held: null,
    agentName: "Halftime",
  });
  assert.equal(label, "Reading the balance…");
});

test("an accented name becomes a plain handle", () => {
  assert.equal(deriveHandle("Édouard"), "edouard");
});

test("an amount without a whole or a fraction part is not an amount", () => {
  assert.equal(parseAmount(".5", "AUSD"), null);
  assert.equal(parseAmount("1.", "AUSD"), null);
});

test("a day's cap below one trade's is 'Fix the caps to create'", () => {
  const form = filled({ perTrade: 25, perDay: 20 });
  assert.equal(createLabel(form, "free", wallet()), "Fix the caps to create");
  assert.equal(canCreate(form, "free", wallet()), false);
});

test("a section's tag: empty, default, edited, and its line count", () => {
  assert.deepEqual(sectionTag("thesis", "  "), { text: "EMPTY", edited: false });
  assert.deepEqual(sectionTag("thesis", DEFAULT_BRIEF.thesis), { text: "DEFAULT", edited: false });
  assert.deepEqual(sectionTag("thesis", "Mine."), { text: "EDITED", edited: true });
  assert.deepEqual(sectionTag("enters", DEFAULT_BRIEF.enters), {
    text: "3 LINES · DEFAULT",
    edited: false,
  });
  assert.deepEqual(sectionTag("never", "One line"), { text: "1 LINE · EDITED", edited: true });
});

test("a reload mid-setup restores the unlinked agent wallet, its balances and its policies", () => {
  const restored = unlinkedWallet({
    master: { address: "0xm", ausdMicro: "1", monWei: "1" },
    agents: [
      {
        walletId: "linked",
        address: "0x1",
        ausdMicro: "5",
        monWei: "5",
        agentId: "agent",
        agentName: "Old",
        caps: null,
        policiesApproved: true,
      },
      {
        walletId: "new",
        address: "0x2",
        ausdMicro: "10000000",
        monWei: null,
        agentId: null,
        agentName: null,
        caps: null,
        policiesApproved: true,
      },
    ],
    readAt: 0,
  });
  assert.deepEqual(restored, {
    wallet: { walletId: "new", address: "0x2", ausdMicro: 10_000_000n, monWei: null },
    policiesApproved: true,
  });
});

test("no unlinked agent wallet restores nothing", () => {
  assert.equal(
    unlinkedWallet({
      master: { address: "0xm", ausdMicro: null, monWei: null },
      agents: [],
      readAt: 0,
    }),
    null,
  );
});

test("the wallet sheet resumes at step 2 when the wallet exists and its delegated user does not", () => {
  assert.equal(walletSheetStep(wallet(), false), 2);
});

test("the wallet sheet starts at step 1 with no wallet, or with the delegated user there", () => {
  assert.equal(walletSheetStep(null, false), 1);
  assert.equal(walletSheetStep(wallet(), true), 1);
  assert.equal(walletSheetStep(wallet(), null), 1);
});

test("caps are inverted only when a day's cap is below one trade's", () => {
  assert.equal(capsInverted(filled({ perTrade: 25, perDay: 20 })), true);
  assert.equal(capsInverted(filled({ perTrade: 20, perDay: 20 })), false);
});

test("caps are edited once any of the three leaves the starter caps", () => {
  assert.equal(capsEdited(filled()), false);
  assert.equal(capsEdited(filled({ leverage: 2 })), true);
});

test("a handle is 3–15 of a–z, 0–9 and _", () => {
  assert.equal(validHandle("ht_bot"), true);
  assert.equal(validHandle("ab"), false);
  assert.equal(validHandle("Halftime"), false);
});

test("with two unlinked wallets the newest is restored, as the API reuses it", () => {
  const unlinked = (walletId: string) => ({
    walletId,
    address: walletId,
    ausdMicro: null,
    monWei: null,
    agentId: null,
    agentName: null,
    caps: null,
    policiesApproved: false,
  });

  const restored = unlinkedWallet({
    master: { address: "0xm", ausdMicro: null, monWei: null },
    agents: [unlinked("older"), unlinked("newer")],
    readAt: 0,
  });

  assert.equal(restored?.wallet.walletId, "newer");
});

test("arrivals name each token that rose", () => {
  const news = arrived(
    wallet(),
    wallet({ ausdMicro: 12_500_000n, monWei: 1_000_000_000_000_000_000n }),
    "10:00",
  );

  assert.deepEqual(news, [
    { text: "2.5 AUSD arrived", at: "10:00" },
    { text: "0.5 MON arrived", at: "10:00" },
  ]);
});

test("an unread balance on either side is no arrival", () => {
  assert.deepEqual(arrived(wallet({ ausdMicro: null }), wallet(), "10:00"), []);
  assert.deepEqual(arrived(wallet(), wallet({ monWei: null }), "10:00"), []);
});

test("a decrease is no arrival", () => {
  assert.deepEqual(arrived(wallet(), wallet({ ausdMicro: 1n }), "10:00"), []);
});

test("the wallet sheet counts its steps only the first time", () => {
  const first = sheetCopy({ kind: "wallet", step: 1, firstTime: true, form: filled() });
  const second = sheetCopy({ kind: "wallet", step: 2, firstTime: true, form: filled() });
  const later = sheetCopy({ kind: "wallet", step: 1, firstTime: false, form: filled() });

  assert.equal(first.title, "Create Halftime's wallet?");
  assert.equal(first.body, "UNDER YOUR PASSKEY · ONLY THIS AGENT USES IT · 1 OF 2");
  assert.equal(second.body, "INSIDE THE CAPS ONLY · NEVER WITHDRAW · 2 OF 2");
  assert.equal(later.body, "UNDER YOUR PASSKEY · ONLY THIS AGENT USES IT");
});

test("the create sheet says the caps and who holds the trades to them", () => {
  const copy = sheetCopy({ kind: "create", step: 1, firstTime: false, form: filled() });

  assert.equal(copy.title, "Create Halftime?");
  assert.equal(
    copy.body,
    "SETS ITS CAPS · 5 / 20 AUSD · 1× · IT CAN ONLY TRADE ON PERPL AND CAN'T WITHDRAW · PICKLER HOLDS EVERY TRADE TO THESE CAPS",
  );
  assert.equal(copy.done, "Halftime is yours");
});

test("step 0 the first time is two Touch IDs, listed", () => {
  const copy = step0Copy({ firstTime: true, pendingDelegate: false });

  assert.equal(copy.tag, "STEP 0 · CREATE IT");
  assert.equal(
    copy.note,
    "A wallet that is only its own. Two Touch IDs, back to back, the first time only.",
  );
  assert.deepEqual(copy.steps, [
    { n: "1", text: "Its wallet, under your passkey", done: false },
    { n: "2", text: "Pickler may trade from it · inside the caps · never withdraw", done: false },
  ]);
  assert.equal(copy.cta, "Create its wallet · 2 signatures");
});

test("step 0 later is one Touch ID, with no list", () => {
  const copy = step0Copy({ firstTime: false, pendingDelegate: false });

  assert.equal(copy.note, "A wallet that is only its own. One Touch ID.");
  assert.deepEqual(copy.steps, []);
  assert.equal(copy.cta, "Create its wallet");
});

test("step 0 after a cancelled step 2 offers step 2 only, step 1 done", () => {
  const copy = step0Copy({ firstTime: true, pendingDelegate: true });

  assert.equal(copy.tag, "STEP 0 · 1 OF 2 DONE");
  assert.equal(
    copy.note,
    "Its wallet is made, under your passkey. One more Touch ID lets Pickler trade from it.",
  );
  assert.deepEqual(
    copy.steps.map((step) => step.done),
    [true, false],
  );
  assert.equal(copy.cta, "Let Pickler trade from it · step 2");
});

test("the balance note: not checked, waiting for what is short, nothing once funded", () => {
  assert.equal(balanceNote(wallet({ ausdMicro: 0n, monWei: 0n }), ""), "NOT CHECKED YET");
  assert.equal(
    balanceNote(wallet({ ausdMicro: 0n, monWei: 0n }), "10:00"),
    "LAST CHECKED 10:00 · WAITING FOR AUSD AND MON",
  );
  assert.equal(
    balanceNote(wallet({ monWei: 0n }), "10:00"),
    "LAST CHECKED 10:00 · WAITING FOR MON",
  );
  assert.equal(
    balanceNote(wallet({ ausdMicro: 9_999_999n }), "10:00"),
    "LAST CHECKED 10:00 · WAITING FOR AUSD",
  );
  assert.equal(balanceNote(wallet(), "10:00"), "LAST CHECKED 10:00");
});

test("the wallet card is outlined when only the money is missing", () => {
  const empty = wallet({ ausdMicro: 0n });

  assert.equal(walletOutlined(filled(), "free", null), true);
  assert.equal(walletOutlined(filled(), "free", empty), true);
  assert.equal(walletOutlined(filled(), "free", wallet()), false);
  assert.equal(walletOutlined(filled({ voice: null }), "free", empty), false);
  assert.equal(walletOutlined(filled(), "checking", empty), false);
  assert.equal(walletOutlined(filled({ name: " " }), "free", empty), false);
});

test("radioStep: arrows move and wrap, Home and End jump, other keys do nothing", async () => {
  const { radioStep } = await import("../src/features/studio/new-agent/model");
  assert.equal(radioStep("ArrowRight", 0, 7), 1);
  assert.equal(radioStep("ArrowDown", 6, 7), 0);
  assert.equal(radioStep("ArrowLeft", 0, 7), 6);
  assert.equal(radioStep("ArrowUp", 3, 7), 2);
  assert.equal(radioStep("Home", 4, 6), 0);
  assert.equal(radioStep("End", 1, 6), 5);
  assert.equal(radioStep("Enter", 1, 6), null);
});
