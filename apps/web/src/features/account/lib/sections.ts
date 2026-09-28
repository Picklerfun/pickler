// Which of the account's three sections is on screen, and how a check reaches the other two.
//
// The sections are a rail rather than three routes: they are one screen's tabs, they share the top
// bar, the rail and the person's identity, and nothing about them is worth a page load or a
// browser-history entry. That choice has a cost, and it is the reason this file exists — two of the
// three are unreachable to anything that only opens `/account`, so every contrast, token and type
// measurement would report on the wallet and call the screen green. A section no check can reach is
// a section that rots.
//
// So `?section=` puts one on screen. It is guarded outside production for the same reason the
// studio guards its own: not because naming a tab is dangerous — it manufactures no data, and the
// sections behind it are gated by exactly the authentication the rest of the screen is — but
// because a query parameter that exists to be measured is not part of the product's public surface.

export type SectionKey = "wallet" | "security" | "profile";

export const SECTIONS: { key: SectionKey; label: string; tint: "lime" | "amber" | "violet" }[] = [
  { key: "wallet", label: "Wallet", tint: "lime" },
  { key: "security", label: "Security", tint: "amber" },
  { key: "profile", label: "Public profile", tint: "violet" },
];

const KEYS = new Set<string>(SECTIONS.map((section) => section.key));

/**
 * The section a request opens on: the `?section=` it was given where that is allowed and names one,
 * the wallet otherwise.
 *
 * `nodeEnv` is an argument rather than a read of `process.env` so the gate can be pinned in both
 * positions. A gate tested only in the environment the test happens to run in is a gate tested
 * once, which is how a guard that never closes ships looking green.
 */
export function openingSection(nodeEnv: string | undefined, asked: string | undefined): SectionKey {
  if (nodeEnv === "production" || asked === undefined) {
    return "wallet";
  }
  return KEYS.has(asked) ? (asked as SectionKey) : "wallet";
}
