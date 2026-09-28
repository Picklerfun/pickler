/**
 * What the studio home shows. A person with no agents lands on the home too — the top bar, the
 * Menu, the profile and the second-passkey suggestion — with an empty state where the board would
 * be, rather than being sent to `/studio/new` before they have seen anything. Pure, and pinned in
 * `studio-landing.test.ts`.
 *
 * `loading` until the agents have been read: an empty list before the read is not an empty
 * studio, and saying "no agent yet" to someone who has three would be wrong for a moment.
 */
export type Landing = "loading" | "empty" | "board";

export function studioLanding(loaded: boolean, agents: readonly unknown[]): Landing {
  if (agents.length > 0) {
    return "board";
  }
  return loaded ? "empty" : "loading";
}
