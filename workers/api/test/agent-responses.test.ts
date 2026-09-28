import test from "node:test";
import assert from "node:assert/strict";
import { agentScore } from "@pickler/core";
import type {
  AgentPersona,
  AgentProfile,
  AgentSummary,
  DirectoryAgent,
  ReadService,
} from "@pickler/core";
import {
  toAgentPersonaDto,
  toAgentProfileDto,
  toAgentSummaryDto,
  toDirectoryAgentDto,
} from "../src/growth/agent-responses.js";

// A real agent has a name, a handle and a profile. Today it has no token and no record, and the
// wire format must be able to say so rather than inventing a zero or a slug for it.

const summary = (ticker: string | null): AgentSummary => ({
  name: "Halftime",
  handle: "halftime",
  ticker,
  beat: "sports",
  accent: "lime",
  venue: "predictions",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  resolved: 0,
  hitRate: null,
  net: 0,
  token: null,
});

const service: ReadService = {
  open: true,
  closedNote: null,
  price: 4,
  markets: ["BTC-PERP"],
  typical: "~2 min",
  sla: "10 min",
  slots: "2 of 6",
  evaluated: 0,
  gap: 3,
};

const persona = (overrides: Partial<AgentPersona> = {}): AgentPersona => ({
  name: "Halftime",
  handle: "halftime",
  ticker: null,
  accent: "lime",
  beat: "sports",
  venue: "predictions",
  vibe: "patient",
  voice: "dry",
  blurb: "",
  xHandle: null,
  creatorHandle: null,
  calibrationGap: null,
  resolved: 0,
  hitRate: null,
  net: 0,
  openPicks: 0,
  aliveDays: 1,
  marketCap: null,
  stage: null,
  meters: [],
  decides: "",
  wrong: "",
  askPrice: null,
  answers: [],
  decisions: [],
  service: null,
  reads: [],
  ...overrides,
});

test("an agent without a token has no slug, and one with a token has the token's", () => {
  assert.equal(toAgentSummaryDto(summary(null)).slug, null);
  assert.equal(toAgentSummaryDto(summary(null)).ticker, null);
  assert.equal(toAgentSummaryDto(summary("$HALF")).slug, "half");
});

test("a persona with no settled record has no score, and nothing is defaulted to a number", () => {
  const dto = toAgentPersonaDto(persona());

  assert.equal(dto.score, null);
  assert.equal(dto.calibrationGap, null);
  assert.equal(dto.marketCap, null);
  assert.equal(dto.stage, null);
  assert.equal(dto.askPrice, null);
  assert.equal(dto.service, null);
  assert.equal(dto.slug, null);
});

test("a persona with a calibration gap is scored the way the leaderboard scores it", () => {
  const record = { calibrationGap: 3, resolved: 90, net: 120 };

  const dto = toAgentPersonaDto(persona(record));

  assert.equal(dto.score, agentScore(record));
});

test("the persona carries no followers, brief or rules on the wire", () => {
  const dto = toAgentPersonaDto(persona()) as Record<string, unknown>;

  assert.equal("followers" in dto, false);
  assert.equal("brief" in dto, false);
  assert.equal("rules" in dto, false);
});

test("the token profile carries no followers or brief on the wire either", () => {
  const profile: AgentProfile = {
    ...summary("$HALF"),
    blurb: "",
    xHandle: null,
    creatorHandle: null,
    openPicks: 0,
    market: null,
    calls: [],
  };
  const dto = toAgentProfileDto(profile) as Record<string, unknown>;

  assert.equal("followers" in dto, false);
  assert.equal("brief" in dto, false);
  assert.equal(dto.slug, "half");
});

test("a read service is written with each market's question, and its absence passes through", () => {
  const entry = (offering: ReadService | null): DirectoryAgent => ({
    agent: { name: "Halftime", handle: "halftime", ticker: null, accent: "lime" },
    beat: "sports",
    venue: "perps",
    decides: "",
    score: null,
    hitRate: null,
    resolved: 0,
    net: 0,
    service: offering,
  });

  assert.equal(toDirectoryAgentDto(entry(null)).service, null);
  assert.equal(toDirectoryAgentDto(entry(null)).score, null);

  const withService = toDirectoryAgentDto(entry(service));
  assert.equal(withService.service?.markets[0]?.name, "BTC-PERP");
  assert.match(withService.service?.markets[0]?.question ?? "", /BTC-PERP/);
  assert.equal(toAgentPersonaDto(persona({ service })).service?.price, 4);
});
