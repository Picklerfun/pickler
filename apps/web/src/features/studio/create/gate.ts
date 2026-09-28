/**
 * Whether a new agent may be created, decided before the first passkey prompt: one unfunded agent
 * at a time (docs/specs/studio-create-and-fund-v1.md). `POST /v1/studio/agents` enforces the same
 * lock (409 `UNFUNDED_AGENT`), but only after the wallet and its rules were approved, so the create
 * screen and the shell's "New agent" item ask here first. Pure, and pinned in
 * `studio-create-gate.test.ts`.
 */
import type { Agent } from "../api";
import { MIN_FUNDED_AUSD } from "../home/status";

type GateAgent = Pick<Agent, "id" | "productId" | "name" | "wallet" | "canCreateAnother">;

export type CreateGate<A extends GateAgent = GateAgent> =
  { open: true } | { open: false; agent: A };

/**
 * Open with no agents, or when the API says another may be created. Closed otherwise, naming the
 * agent to fund: the first one below the minimum, or the first agent when none reads as unfunded.
 */
export function createGate<A extends GateAgent>(agents: readonly A[]): CreateGate<A> {
  const first = agents[0];
  if (!first || agents.every((agent) => agent.canCreateAnother.ok)) {
    return { open: true };
  }
  const unfunded = agents.find((agent) => (agent.wallet?.balanceAusd ?? 0) < MIN_FUNDED_AUSD);
  return { open: false, agent: unfunded ?? first };
}

/** The canvas's words for the lock, naming the agent to fund. */
export function gateNote(agent: GateAgent): { title: string; note: string } {
  return {
    title: `Fund ${agent.name ?? "your agent"} first.`,
    note: "One unfunded agent at a time.",
  };
}

/** Where "Fund it" goes: the studio, opened on that agent. */
export function gateHref(agent: GateAgent): string {
  return `/studio?agent=${encodeURIComponent(agent.productId ?? agent.id)}`;
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
