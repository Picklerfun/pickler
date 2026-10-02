// apps/web/src/features/studio/new-agent/transfer-model.ts
/**
 * The Wallets modal's rules (spec §3.3, §4.2, D7, D12): what a move's source holds, its body, MAX
 * and the gas it keeps back, the button's words, the note, the passkey sheet's words, and what a
 * failed transfer says. Pure, no React and no transport, so each rule is pinned in
 * `apps/web/test/studio-new-agent-transfer.test.ts`.
 */
import type { WalletsDto } from "@pickler/api-schema";
import {
  DECIMALS,
  formatUnits,
  parseAmount,
  shortAddress,
  toTransferBody,
  unitsOf,
  type Token,
} from "./model";

/** A typed amount as the field keeps it: a decimal comma is a point, anything else is dropped. */
export const cleanAmount = (text: string): string =>
  text.replace(/,/g, ".").replace(/[^0-9.]/g, "");

/** Base units as every decimal they hold, for MAX: 1234567 AUSD-micro → "1.234567". "" when unread. */
export function exactUnits(units: bigint | null, token: Token): string {
  if (units === null) {
    return "";
  }
  const scale = 10n ** BigInt(DECIMALS[token]);
  const fraction = (units % scale).toString().padStart(DECIMALS[token], "0").replace(/0+$/, "");
  return fraction ? `${units / scale}.${fraction}` : (units / scale).toString();
}

/**
 * What MAX leaves in a wallet when it moves MON: an estimate that the fee of a native transfer
 * (21k–25k gas) stays under on Monad. Only MAX keeps it back; a typed amount is checked against the
 * whole balance, and the server's INSUFFICIENT_GAS stays the final word.
 */
export const MON_GAS_RESERVE_WEI = 10_000_000_000_000_000n;

/** What MAX fills: every AUSD the source holds; its MON less the gas reserve, never below 0. */
export function maxAmount(held: bigint | null, token: Token): string {
  if (held === null || token === "AUSD") {
    return exactUnits(held, token);
  }
  return exactUnits(held > MON_GAS_RESERVE_WEI ? held - MON_GAS_RESERVE_WEI : 0n, token);
}

export interface TransferInput {
  amount: string;
  token: Token;
  toAgent: boolean;
  /** What the source holds of the token, in base units; null when unread. */
  held: bigint | null;
  agentName: string;
}

/** Whether a move may be signed, and the button's words. One rule feeds both. */
function transferBlock(input: TransferInput): { ok: boolean; label: string } {
  const amount = input.amount.trim();
  const units = parseAmount(amount, input.token);
  if (units === null) {
    return { ok: false, label: "Enter an amount" };
  }
  if (input.held === null) {
    return { ok: false, label: "Reading the balance…" };
  }
  if (units > input.held) {
    return {
      ok: false,
      label: `More ${input.token} than ${input.toAgent ? "the master wallet" : input.agentName} holds`,
    };
  }
  return {
    ok: true,
    label: input.toAgent
      ? `Send ${amount} ${input.token} to ${input.agentName}`
      : `Pull ${amount} ${input.token} back`,
  };
}

export const transferLabel = (input: TransferInput): string => transferBlock(input).label;

/** A positive amount the source holds: the move's button opens. */
export const canMove = (input: TransferInput): boolean => transferBlock(input).ok;

/** One move in the Wallets modal: an agent wallet, toward it or back to master, one token. */
export interface Move {
  walletId: string;
  toAgent: boolean;
  token: Token;
}

/**
 * What the move's source holds of its token: the master wallet toward the agent, the agent wallet
 * on a pull. Null when it is unread or the wallet is not in the list.
 */
export function moveSource(wallets: WalletsDto, move: Move): bigint | null {
  const source = move.toAgent
    ? wallets.master
    : wallets.agents.find((agent) => agent.walletId === move.walletId);
  if (!source) {
    return null;
  }
  return unitsOf(move.token === "AUSD" ? source.ausdMicro : source.monWei);
}

/** The transfer routes' body for a move: master on exactly one side, the amount trimmed. */
export const moveBody = (move: Move, amount: string) =>
  toTransferBody({
    from: move.toAgent ? "master" : move.walletId,
    to: move.toAgent ? move.walletId : "master",
    token: move.token,
    amount,
  });

/**
 * Under the move form: what the source holds, that a pull leaves open positions alone, and that
 * MAX kept MON back for the fee.
 */
export function moveNote(input: {
  toAgent: boolean;
  held: bigint | null;
  token: Token;
  keptForGas?: boolean;
}): string {
  const holds = `${input.toAgent ? "MASTER HOLDS" : "IT HOLDS"} ${formatUnits(input.held, input.token)} ${input.token}`;
  const positions = input.toAgent ? "" : " · OPEN POSITIONS STAY";
  const gas = input.keptForGas
    ? ` · KEEPS ${formatUnits(MON_GAS_RESERVE_WEI, "MON")} MON FOR GAS`
    : "";
  return `${holds} · ONE TOKEN PER TRANSACTION${positions}${gas}`;
}

/** The passkey sheet's words for a move (canvas "xfer"). */
export function moveSheetCopy(input: {
  amount: string;
  token: Token;
  toAgent: boolean;
  agentName: string;
  address: string;
}): { title: string; body: string; done: string } {
  const amount = `${input.amount.trim()} ${input.token}`;
  const agent = shortAddress(input.address);
  return input.toAgent
    ? {
        title: `Move ${amount} to ${input.agentName}?`,
        body: `MASTER → ${agent} · ONE TRANSACTION`,
        done: "Moved",
      }
    : {
        title: `Move ${amount} back to master?`,
        body: `${agent} → MASTER · ONE TRANSACTION`,
        done: "Moved",
      };
}

type AgentWallet = WalletsDto["agents"][number];

/**
 * An agent wallet's tag: CREATING while no agent has it, DRAFT once one does. The wallets list does
 * not say whether an agent runs, so LIVE is not drawn yet.
 */
export const agentWalletTag = (agent: AgentWallet): "CREATING" | "DRAFT" =>
  agent.agentId === null ? "CREATING" : "DRAFT";

/** Its agent's name, else the name of the agent this screen is creating on it. */
export function walletName(
  agent: AgentWallet,
  draft: { walletId: string; name: string } | null,
): string {
  if (agent.agentName) {
    return agent.agentName;
  }
  const name = draft?.walletId === agent.walletId ? draft.name.trim() : "";
  return name || "Your new agent";
}

/** How a failed transfer ends: the sheet offers Try again, it went through, or it failed. */
export function failedTransfer(input: {
  closedPrompt: boolean;
  code: string;
  stamped: boolean;
}): "cancelled" | "done" | "failed" {
  // A cancellation after the stamp is not a cancellation: the transfer may already be on chain.
  if (input.closedPrompt && !input.stamped) {
    return "cancelled";
  }
  if (input.code === "TRANSFER_ALREADY_RECORDED") {
    return "done";
  }
  return "failed";
}

/**
 * The codes a confirm answers only when nothing was broadcast: the checks before the broadcast
 * refused it. After the stamp only these may speak for themselves; every other code (an
 * unavailable backend, NOT_SENDABLE, one the studio does not know) may have gone through.
 */
export const POST_STAMP_SAFE: ReadonlySet<string> = new Set([
  "INVALID_TRANSFER",
  // Prepare-only: confirm never reads the balances again. Kept, as harmless, should that change.
  "INSUFFICIENT_FUNDS",
  "INSUFFICIENT_GAS",
  "FEE_TOO_HIGH",
  "NONCE_GAP",
  "WALLET_NOT_FOUND",
  "INVALID_SIGNED_ACTIVITY",
  "SIGNED_ACTIVITY_REJECTED",
  // Turnkey signed a transaction other than the approved one; it is refused before the broadcast.
  "SIGNED_TX_MISMATCH",
]);

/**
 * What a failed transfer says. Before the stamp nothing can have moved, so the studio's message
 * for any code is shown. After it, only a code in `POST_STAMP_SAFE` speaks for itself; anything
 * else may have gone through, and the person is sent to the balances before sending again.
 */
export function transferFailure(input: {
  sessionExpired: boolean;
  /** The studio's code and message, when the API answered with one. */
  studio: { code: string; message: string } | null;
  stamped: boolean;
}): string {
  if (input.sessionExpired) {
    return "Your sign-in expired. Sign in again; nothing moved.";
  }
  const { studio, stamped } = input;
  if (studio && studio.message && (!stamped || POST_STAMP_SAFE.has(studio.code))) {
    return studio.message;
  }
  return stamped
    ? "It may have gone through. Check the balances above before sending again."
    : "It did not go through. Nothing moved.";
}
