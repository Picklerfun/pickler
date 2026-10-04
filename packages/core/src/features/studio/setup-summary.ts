import { effectiveStudioStrategy } from "../research/trading-config.js";
/**
 * The one line a saved setup is recorded under (docs/specs/studio-live-v1.md L10): what changed
 * between two configs, built here from the stored configs so a version never carries client text.
 */
import { effectiveEntry, type AgentConfig } from "../research/types.js";
import { VOICES } from "./create.js";

/** The database's bound on `agents.setup_versions.summary`. */
export const SETUP_SUMMARY_MAX = 200;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The 1-based positions in `longer` of the lines `shorter` lacks, or null when it is not `longer` with lines taken out. */
function extraLines(shorter: readonly string[], longer: readonly string[]): number[] | null {
  const extra: number[] = [];
  let at = 0;
  longer.forEach((line, index) => {
    if (at < shorter.length && shorter[at] === line) {
      at += 1;
    } else {
      extra.push(index + 1);
    }
  });
  return at === shorter.length ? extra : null;
}

/**
 * One section's lines, by number. Lines only put in or only taken out are named as that, wherever
 * they sat, so a line added in the middle is not every later line "changed". Anything else is
 * compared place by place.
 */
function lineChanges(label: string, prev: readonly string[], next: readonly string[]): string[] {
  if (next.length > prev.length) {
    const added = extraLines(prev, next);
    if (added) {
      return added.map((number) => `${label} ${number} added`);
    }
  }
  if (next.length < prev.length) {
    const removed = extraLines(next, prev);
    if (removed) {
      return removed.map((number) => `${label} ${number} removed`);
    }
  }
  const parts: string[] = [];
  for (let index = 0; index < Math.max(prev.length, next.length); index += 1) {
    const before = prev[index];
    const after = next[index];
    if (before === after) {
      continue;
    }
    const what = before === undefined ? "added" : after === undefined ? "removed" : "changed";
    parts.push(`${label} ${index + 1} ${what}`);
  }
  return parts;
}

/** "Caps 25 / 100 / 3× · 3 open · −20 day-loss", with only the parts the config has. */
function capsPart(config: AgentConfig): string {
  const parts: string[] = [];
  if (config.spend && config.maxLeverage !== undefined) {
    parts.push(`${config.spend.perCallAusd} / ${config.spend.perDayAusd} / ${config.maxLeverage}×`);
  }
  if (config.risk) {
    parts.push(`${config.risk.maxOpenPositions} open`, `−${config.risk.dayLossStopAusd} day-loss`);
  }
  return `Caps ${parts.join(" · ")}`.trim();
}

function entryPart(config: AgentConfig): string {
  const entry = effectiveEntry(config);
  if (entry.mode === "auto") {
    return "Enters on its own";
  }
  return entry.meanwhile === "small"
    ? `Goes in at ${entry.smallAusd} while you decide`
    : "Asks before entering";
}

/**
 * What a save changed, in the order the studio draws it: the brief (thesis, then each changed
 * line), caps, sources, voice, how it enters. Parts are joined with " · " and only the first keeps
 * its capital; "No change" when the two configs hold the same setup. At most 200 characters.
 */
export function setupChangeSummary(prev: AgentConfig, next: AgentConfig): string {
  const parts: string[] = [];
  const strategy = effectiveStudioStrategy(next);
  if (!same(effectiveStudioStrategy(prev), strategy)) {
    parts.push(`Strategy ${strategy.id}@${strategy.version}`);
  }
  if ((prev.brief?.thesis ?? "") !== (next.brief?.thesis ?? "")) {
    parts.push("Thesis changed");
  }
  parts.push(
    ...lineChanges("Entry", prev.brief?.entersWhen ?? [], next.brief?.entersWhen ?? []),
    ...lineChanges("Exit", prev.brief?.exitsWhen ?? [], next.brief?.exitsWhen ?? []),
    ...lineChanges("Never", prev.brief?.never ?? [], next.brief?.never ?? []),
  );
  if (
    !same(prev.spend, next.spend) ||
    prev.maxLeverage !== next.maxLeverage ||
    !same(prev.risk, next.risk)
  ) {
    parts.push(capsPart(next));
  }
  if (!same(prev.sources, next.sources)) {
    parts.push("Sources changed");
  }
  if (prev.voice !== next.voice) {
    const voice = VOICES.find((candidate) => candidate.key === next.voice);
    parts.push(`Voice · ${voice?.name ?? next.voice ?? "none"}`);
  }
  if (!same(prev.entry, next.entry)) {
    parts.push(entryPart(next));
  }
  if (parts.length === 0) {
    return "No change";
  }
  const text = parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)))
    .join(" · ");
  return text.length > SETUP_SUMMARY_MAX ? `${text.slice(0, SETUP_SUMMARY_MAX - 1)}…` : text;
}
