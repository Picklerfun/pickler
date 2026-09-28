/**
 * Which agent the studio opens on. `/studio?agent=<id>` names one — the creation flow's "Open the
 * studio" links there — and the studio falls back to the first agent when the parameter is absent
 * or names none of the person's agents. Pure, and pinned in `studio-select.test.ts`.
 *
 * Deliberately not in a client module, so `/studio`'s server page can read it as a value.
 */

/** The `?agent=` value, trimmed, or undefined when there is none. */
export function agentFromSearch(asked: string | string[] | undefined): string | undefined {
  const value = (Array.isArray(asked) ? asked[0] : asked)?.trim();
  return value ? value : undefined;
}

/** The asked agent's id when it is in the list, otherwise the first agent's, or null for none. */
export function selectAgent(
  agents: readonly { id: string; productId?: string | undefined }[],
  asked: string | undefined,
): string | null {
  const idOf = (agent: { id: string; productId?: string | undefined }) =>
    agent.productId ?? agent.id;
  const match = asked ? agents.find((agent) => idOf(agent) === asked) : undefined;
  const chosen = match ?? agents[0];
  return chosen ? idOf(chosen) : null;
}
