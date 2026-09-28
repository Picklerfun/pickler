import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEATS,
  SOON_BEATS,
  SOON_VENUES,
  draftToConfig,
  unsupported,
  type AgentDraft,
} from "../src/features/studio/draft.js";
import { assertConfig } from "../src/features/research/types.js";

const draft: AgentDraft = {
  name: "Halftime",
  handle: "halftime",
  venues: ["polymarket"],
  beat: "Sports",
  subcategories: ["NFL"],
  sites: ["espn.com", "nfl.com"],
  skills: ["Injury double-check"],
  edge: "It reads injury reports before the books move.",
  style: "balanced",
  accent: "lime",
};

test("a supported draft maps onto a config the runtime accepts", () => {
  const config = draftToConfig(draft);

  assert.deepEqual(config.marketScope, {
    version: 1,
    category: "sports",
    subcategories: ["american-football"],
  });
  assert.deepEqual(config.sources, {
    web: { mode: "prefer", sites: ["espn.com", "nfl.com"] },
    books: [],
  });
  assert.equal(config.skills?.[0]?.name, "Injury double-check");
  assert.equal(config.profile, draft.edge);
  assert.equal(config.uncertaintyPolicy?.minProbabilityMargin, 0.04);
  assert.equal(config.intervalHours, 6);
});

test("perpl and every beat but sports are reported as unsupported, not silently dropped", () => {
  assert.deepEqual(unsupported({ ...draft, venues: ["polymarket", "perpl"] }), ["venue:perpl"]);
  assert.deepEqual(unsupported({ ...draft, beat: "Economics", subcategories: ["Fed"] }), [
    "beat:Economics",
  ]);
  assert.deepEqual(unsupported(draft), []);
  assert.ok(SOON_VENUES.includes("perpl"));
  assert.ok(SOON_BEATS.includes("Crypto"));
  assert.throws(() => draftToConfig({ ...draft, venues: ["perpl"] }), /venue:perpl/);
});

test("a subcategory label maps to the runtime's sport id, and an unknown one is refused", () => {
  assert.throws(() => draftToConfig({ ...draft, subcategories: ["Cricket"] }), /Cricket/);
  assert.ok(
    BEATS.find((b) => b.name === "Sports")?.subs.some(
      (s) => s.label === "NFL" && s.id === "american-football",
    ),
  );
});

test("skills the beat does not suggest are dropped, and no sites means the whole web", () => {
  const config = draftToConfig({ ...draft, sites: [], skills: ["Made up", "Weather at kickoff"] });

  assert.deepEqual(config.sources?.web, { mode: "anywhere", sites: [] });
  assert.deepEqual(
    config.skills?.map((skill) => skill.name),
    ["Weather at kickoff"],
  );
});

test("the config a draft produces passes assertConfig", () => {
  assert.doesNotThrow(() => assertConfig(draftToConfig(draft)));
  assert.doesNotThrow(() => assertConfig(draftToConfig({ ...draft, sites: [] })));
});
