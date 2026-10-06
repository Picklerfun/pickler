// Account sections share one authenticated screen. The navbar's profile link is a product deep
// link in every environment. Other query-selected sections are kept for non-production design
// checks; no query manufactures identity or bypasses the screen's existing authorization.

export type SectionKey = "wallet" | "security" | "profile" | "access";

export const SECTIONS: { key: SectionKey; label: string; tint: "lime" | "amber" | "violet" }[] = [
  { key: "wallet", label: "Wallet", tint: "lime" },
  { key: "security", label: "Security", tint: "amber" },
  { key: "profile", label: "Public profile", tint: "violet" },
  { key: "access", label: "Creator access", tint: "amber" },
];

const KEYS = new Set<string>(SECTIONS.map((section) => section.key));

/**
 * The section a request opens on: the `?section=` it was given where that is allowed and names one,
 * the wallet otherwise. The profile product link works in every environment.
 *
 * `nodeEnv` is an argument rather than a read of `process.env` so the gate can be pinned in both
 * positions. A gate tested only in the environment the test happens to run in is a gate tested
 * once, which is how a guard that never closes ships looking green.
 */
export function openingSection(nodeEnv: string | undefined, asked: string | undefined): SectionKey {
  if (asked === "profile") {
    return "profile";
  }
  if (nodeEnv === "production" || asked === undefined) {
    return "wallet";
  }
  return KEYS.has(asked) ? (asked as SectionKey) : "wallet";
}
