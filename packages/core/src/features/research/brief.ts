import type { AgentBrief } from "./types.js";

export interface Skill {
  name: string;
  prompt: string;
}

const numbered = (lines: readonly string[]) => lines.map((line, i) => `${i + 1}. ${line}`);

/** The brief's sections in the order §3.1 draws them; an empty optional section is left out. */
function briefBlock(brief: AgentBrief): string[] {
  const block: string[] = [];
  if (brief.thesis) {
    block.push(`Thesis: ${brief.thesis}`);
  }
  if (brief.reads.length > 0) {
    block.push("It reads:", ...numbered(brief.reads));
  }
  block.push("It enters only when every one of these is true:", ...numbered(brief.entersWhen));
  if (brief.exitsWhen.length > 0) {
    block.push("It exits at the first of these that turns true:", ...numbered(brief.exitsWhen));
  }
  if (brief.never.length > 0) {
    block.push("It never:", ...numbered(brief.never));
  }
  return block;
}

/**
 * The brief the model reads: the edge, then the written brief when there is one, then the skills as
 * numbered rules. Stored apart; joined here. Without a brief this is byte for byte the old text.
 */
export function composeBrief(edge: string, skills: readonly Skill[], brief?: AgentBrief): string {
  const parts = [edge];
  if (brief) {
    parts.push("", ...briefBlock(brief));
  }
  if (skills.length > 0) {
    parts.push(
      "",
      "Rules it follows:",
      ...skills.map((s, i) => `${i + 1}. ${s.name} — ${s.prompt}`),
    );
  }
  return parts.join("\n");
}
