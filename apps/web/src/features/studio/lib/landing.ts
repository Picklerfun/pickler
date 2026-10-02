/**
 * What the studio home shows. A person with no agents lands on the create screen inside the
 * studio's frame — the top bar, the Menu, the profile and the second-passkey suggestion — rather
 * than on a separate page. Pure, and pinned in `studio-landing.test.ts`.
 *
 * `loading` until the agents have been read: an empty list before the read is not an empty
 * studio, and saying "no agent yet" to someone who has three would be wrong for a moment.
 */
type Landing = "loading" | "empty" | "home" | "section";

/**
 * With no agents any `section` — the home or a `?section=` deep link — is the create screen, because
 * every section needs an agent. With one, the home or the section asked for.
 */
export function studioLanding(
  loaded: boolean,
  agents: readonly unknown[],
  section: string,
): Landing {
  if (agents.length === 0) {
    return loaded ? "empty" : "loading";
  }
  return section === "home" ? "home" : "section";
}
