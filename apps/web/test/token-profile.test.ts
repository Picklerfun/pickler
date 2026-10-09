import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentProfileDto } from "@pickler/api-schema";
import { hasToken } from "../src/features/agents/lib/token-profile";

// A token page is the token's. The guard is the one question the token routes ask before drawing.

const profile = (ticker: string | null, slug: string | null): AgentProfileDto => ({
  id: "00000000-0000-0000-0000-000000000001",
  advicePrice: null,
  slug,
  name: "Halftime",
  handle: "halftime",
  ticker,
  beat: "sports",
  accent: "lime",
  venue: "predictions",
  createdAt: "2026-09-01T00:00:00.000Z",
  resolved: 0,
  hitRate: null,
  net: 0,
  token: null,
  blurb: "",
  xHandle: null,
  creatorHandle: null,
  openPicks: 0,
  market: null,
  calls: [],
});

test("a profile with a ticker and a slug has a token", () => {
  assert.equal(hasToken(profile("$HALF", "half")), true);
});

test("a profile with neither has no token page to draw", () => {
  assert.equal(hasToken(profile(null, null)), false);
});
