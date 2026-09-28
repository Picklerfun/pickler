export interface Skill {
  name: string;
  prompt: string;
}

/** The brief the model reads: the edge, then the skills as numbered rules. Stored apart; joined here. */
export function composeBrief(edge: string, skills: readonly Skill[]): string {
  if (skills.length === 0) {
    return edge;
  }
  return [
    edge,
    "",
    "Rules it follows:",
    ...skills.map((s, i) => `${i + 1}. ${s.name} — ${s.prompt}`),
  ].join("\n");
}
