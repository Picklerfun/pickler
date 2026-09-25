import {
  composeBrief,
  type ResearchModel,
  type ResearchRepository,
  type RunRecord,
  type SportsData,
} from "@pickler/core";
import { ANYWHERE, siteScopedTools, siteScopedWeb, type DomainSearch } from "../plugins/exa.js";
import { booksOnly } from "../plugins/odds.js";

/** The model reads the person's brief: their edge, then the rules they wrote. */
function briefedModel(
  model: ResearchModel,
  run: RunRecord,
  web: ReturnType<typeof webOf>,
): ResearchModel {
  const skills = run.config.skills ?? [];
  return {
    select(markets, profile, ...rest) {
      return model.select(markets, composeBrief(profile, skills), ...rest);
    },
    research(input) {
      return model.research({
        ...input,
        profile: composeBrief(input.profile, skills),
        tools: siteScopedTools(input.tools, web),
      });
    },
    metadata() {
      return model.metadata();
    },
  };
}

/** Legacy configurations have no sources and keep searching the whole web. */
function webOf(run: RunRecord) {
  const sources = run.config.sources;
  if (!sources) {
    return ANYWHERE;
  }
  return sources.web;
}

/**
 * The adapters one run uses, bound to that run's sources and skills. Every host that executes
 * research through `createRuntime` passes through here, so the configuration is always honoured.
 */
export function scopeRun(
  deps: {
    repository: Pick<ResearchRepository, "event">;
    model: ResearchModel;
    exa: DomainSearch;
    odds?: SportsData;
    now?: () => number;
  },
  run: RunRecord,
) {
  const now = deps.now ?? Date.now;
  const web = webOf(run);
  const scopedWeb = siteScopedWeb(deps.exa, web, (data) =>
    deps.repository.event(run, "sources.fallback", data, now()),
  );
  const books = run.config.sources?.books ?? [];

  return {
    model: briefedModel(deps.model, run, web),
    search: scopedWeb,
    reader: scopedWeb,
    ...(deps.odds ? { odds: booksOnly(deps.odds, books, now) } : {}),
  };
}
