/**
 * Whether a new agent may be created, decided before the first passkey prompt: one unfunded agent
 * at a time (docs/specs/studio-create-and-fund-v1.md). `POST /v1/studio/agents` enforces the same
 * lock (409 `UNFUNDED_AGENT`), but only after the wallet and its rules were approved, so the create
 * screen and the shell's "New agent" item ask here first.
 *
 * The API's lock has two reasons and they are not the same lock (docs/specs/studio-brief-v1.md §6).
 * `unfunded_agent` is about agents with a wallet and closes every way of making an agent. A private
 * draft has no wallet, is never the agent to fund, and counts only toward `draft_limit`, which
 * closes the making of drafts and nothing else: `/studio/new` creates an agent with a wallet and
 * stays open at three drafts. Pure, and pinned in `studio-create-gate.test.ts`.
 */
import type { Agent } from "../api";
import { MIN_FUNDED_AUSD } from "../home/status";
import { studioAgentHref } from "../lib/select";

type GateAgent = Pick<Agent, "id" | "productId" | "name" | "wallet" | "canCreateAnother" | "draft">;

export type CreateGate<A extends GateAgent = GateAgent> =
  { open: true } | { open: false; agent: A };

/** Closed for funding: any closed lock whose reason is not the draft limit. */
const unfundedLock = (agent: GateAgent): boolean =>
  !agent.canCreateAnother.ok && agent.canCreateAnother.reason !== "draft_limit";

/**
 * The funding lock, which is the whole gate for `/studio/new`. Open with no agents, when the API
 * says another may be created, and when all it says is that the drafts are full. Closed otherwise,
 * naming the agent to fund among those that have a wallet to fund: the first one below the
 * minimum, or the first of them when none reads as unfunded. Never a draft, and never an agent
 * without a wallet.
 */
export function createGate<A extends GateAgent>(agents: readonly A[]): CreateGate<A> {
  if (!agents.some(unfundedLock)) {
    return { open: true };
  }
  // A draft has no wallet yet and an agent made before wallets never will: the API counts neither.
  const fundable = agents.filter((agent) => !agent.draft && agent.wallet !== null);
  const unfunded = fundable.find((agent) => (agent.wallet?.balanceAusd ?? 0) < MIN_FUNDED_AUSD);
  const named = unfunded ?? fundable[0];
  // No agent with a wallet is a lock the API cannot have meant; it refuses the create itself.
  return named ? { open: false, agent: named } : { open: true };
}

/**
 * The one line under a shut "+ New agent" in the studio's menus, or "" when it is open. Both
 * entries lead to `/studio/new`, so they read the funding lock and nothing else: at three drafts
 * they stay open. The draft limit is said where a draft is refused (409 `DRAFT_LIMIT`).
 */
export function newAgentLock(agents: readonly GateAgent[]): string {
  const gate = createGate(agents);
  if (gate.open) {
    return "";
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

/** Where "Fund it" goes: the studio's home as this host addresses it, opened on that agent. */
export function gateHref(agent: GateAgent, home: string): string {
  return studioAgentHref(home, agent.productId ?? agent.id);
}

/**
 * Reads the person's agents again and starts the ceremony only through an open gate, so a lock
 * that closed after the screen loaded (another tab created an agent) still stops before the first
 * passkey prompt. A closed gate answers the agent to fund and never calls `start`.
 */
export async function startIfOpen<A extends GateAgent, T>(
  readAgents: () => Promise<readonly A[]>,
  start: () => Promise<T>,
): Promise<{ started: true; value: T } | { started: false; agent: A }> {
  const gate = createGate(await readAgents());
  if (!gate.open) {
    return { started: false, agent: gate.agent };
  }
  return { started: true, value: await start() };
}
