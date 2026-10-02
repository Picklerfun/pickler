/**
 * Whether a new agent may be created, decided before the first passkey prompt: one unfunded agent
 * at a time (docs/specs/studio-create-and-fund-v1.md). `POST /v1/studio/drafts` enforces the same
 * lock (409 `UNFUNDED_AGENT`), but only after the wallet was made, funded and its rules approved, so
 * the shell's "+ New agent" items ask here first.
 *
 * The API's lock has two reasons and they are not the same lock (docs/specs/studio-brief-v1.md §6).
 * `unfunded_agent` is about agents with a wallet, drafts included: a draft is created with its
 * wallet (studio-create-simplified-v1), and the API's `fleet()` counts that wallet's balance like
 * any other. Only an agent without a wallet (one made before wallets, or a draft from before they
 * came with one) is never the agent to fund. `draft_limit` counts the drafts. Every agent is now
 * created as a draft, so both close "+ New agent", before any wallet is made or funded. Pure, and
 * pinned in `studio-gate.test.ts`.
 */
import type { Agent } from "../api";
import { DRAFT_LIMIT_NOTE } from "../lib/messages";
import { MIN_FUNDED_AUSD } from "./status";

/**
 * Core's `MAX_DRAFTS_PER_WORKSPACE`, restated: this module is required by node:test from CommonJS
 * (see `new-agent/model.ts`). `studio-gate.test.ts` pins it against core.
 */
export const MAX_DRAFTS = 3;

type GateAgent = Pick<Agent, "id" | "productId" | "name" | "wallet" | "canCreateAnother" | "draft">;

export type CreateGate<A extends GateAgent = GateAgent> =
  { open: true } | { open: false; agent: A };

/** Closed for funding: any closed lock whose reason is not the draft limit. */
const unfundedLock = (agent: GateAgent): boolean =>
  !agent.canCreateAnother.ok && agent.canCreateAnother.reason !== "draft_limit";

/**
 * The funding lock, which is the whole gate for the create screen. Open with no agents, when the API
 * says another may be created, and when all it says is that the drafts are full. Closed otherwise,
 * naming the agent to fund among those that have a wallet to fund, drafts included: the first one
 * below the minimum, or the first of them when none reads as unfunded. Never an agent without a
 * wallet.
 */
export function createGate<A extends GateAgent>(agents: readonly A[]): CreateGate<A> {
  if (!agents.some(unfundedLock)) {
    return { open: true };
  }
  // The API counts every wallet, a draft's too; an agent without one has nothing to fund.
  const fundable = agents.filter((agent) => agent.wallet !== null);
  const unfunded = fundable.find((agent) => (agent.wallet?.balanceAusd ?? 0) < MIN_FUNDED_AUSD);
  const named = unfunded ?? fundable[0];
  // No agent with a wallet is a lock the API cannot have meant; it refuses the create itself.
  return named ? { open: false, agent: named } : { open: true };
}

/**
 * The draft limit's note, or "" below it. The API's rule: the workspace's drafts counted against
 * `MAX_DRAFTS`, which its `canCreateAnother` also answers as `draft_limit` once nothing is
 * unfunded. Either one closes it, so a list read before the count changed still says so.
 */
export function draftLimitLock(agents: readonly GateAgent[]): string {
  const drafts = agents.filter((agent) => agent.draft).length;
  const told = agents.some((agent) => agent.canCreateAnother.reason === "draft_limit");
  return drafts >= MAX_DRAFTS || told ? DRAFT_LIMIT_NOTE : "";
}

/**
 * The one line under a shut "+ New agent" in the studio's menus, or "" when it is open: the
 * funding lock first, naming the agent (or draft) to fund, then the draft limit. Every agent is
 * created as a draft, so at three drafts the create screen would refuse at the end, after the
 * money moved.
 */
export function newAgentLock(agents: readonly GateAgent[]): string {
  const gate = createGate(agents);
  if (gate.open) {
    return draftLimitLock(agents);
  }
  const { title, note } = gateNote(gate.agent);
  return `${title} ${note}`;
}

/** The canvas's words for the lock, naming the agent to fund. */
export function gateNote(agent: GateAgent): { title: string; note: string } {
  return {
    title: `Fund ${agent.name ?? "your agent"} first.`,
    note: "One unfunded agent at a time.",
  };
}
