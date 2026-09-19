import "server-only";
import {
  agentScore,
  agentSlug,
  readQuestion,
  type ActivityAgent,
  type ActivityEvent,
  type AgentCall,
  type AgentPersona,
  type AgentProfile,
  type AgentRead,
  type AgentSummary,
  type DirectoryAgent,
  type Leaderboard,
  type PickDetail,
  type PlatformAnalytics,
  type Venue,
} from "@pickler/core";
import type {
  ActivityAgentDto,
  ReadServiceDto,
  ActivityEventDto,
  AgentCallDto,
  AgentPersonaDto,
  AgentProfileDto,
  AgentReadDto,
  AgentSummaryDto,
  DirectoryAgentDto,
  LeaderboardDto,
  PickDetailDto,
  PlatformAnalyticsDto,
} from "@pickler/api-schema";

export function toAgentSummaryDto(agent: AgentSummary): AgentSummaryDto {
  return {
    slug: agentSlug(agent.ticker),
    name: agent.name,
    handle: agent.handle,
    ticker: agent.ticker,
    beat: agent.beat,
    accent: agent.accent,
    venue: agent.venue,
    createdAt: agent.createdAt.toISOString(),
    resolved: agent.resolved,
    hitRate: agent.hitRate,
    net: agent.net,
    token: agent.token && { ...agent.token },
  };
}

const toCallDto = (call: AgentCall): AgentCallDto => ({
  id: call.id,
  call: call.call,
  outcome: call.outcome,
  stake: call.stake,
  entryPrice: call.entryPrice,
  calledAt: call.calledAt.toISOString(),
  pnl: call.pnl,
});

export function toAgentProfileDto(profile: AgentProfile): AgentProfileDto {
  return {
    ...toAgentSummaryDto(profile),
    blurb: profile.blurb,
    xHandle: profile.xHandle,
    creatorHandle: profile.creatorHandle,
    followers: profile.followers,
    openPicks: profile.openPicks,
    brief: { ...profile.brief },
    market: profile.market && {
      ...profile.market,
      candles: Object.fromEntries(
        Object.entries(profile.market.candles).map(([range, series]) => [
          range,
          series.map((candle) => ({ ...candle, at: candle.at.toISOString() })),
        ]),
      ) as AgentProfileDto["market"] extends null
        ? never
        : NonNullable<AgentProfileDto["market"]>["candles"],
      topHolders: profile.market.topHolders.map((holder) => ({ ...holder })),
    },
    calls: profile.calls.map(toCallDto),
  };
}

export function toPickDetailDto(pick: PickDetail): PickDetailDto {
  return {
    ...toCallDto(pick),
    agent: { slug: agentSlug(pick.agent.ticker), ...pick.agent },
    thesis: pick.thesis,
    maxPrice: pick.maxPrice,
    settledAt: pick.settledAt?.toISOString() ?? null,
    post: pick.post && { ...pick.post },
    steps: pick.steps.map((step) => ({ ...step, at: step.at?.toISOString() ?? null })),
    chain: { ...pick.chain },
  };
}

const toActivityAgentDto = (agent: ActivityAgent): ActivityAgentDto => ({
  ...agent,
  slug: agentSlug(agent.ticker),
});

const toActivityEventDto = (event: ActivityEvent): ActivityEventDto => ({
  ...event,
  agent: toActivityAgentDto(event.agent),
  at: event.at.toISOString(),
});

/** The question is the same for every read, so it is written once here rather than stored. */
export function toAgentReadDto(read: AgentRead): AgentReadDto {
  return {
    ...read,
    agent: toActivityAgentDto(read.agent),
    question: readQuestion(read.venue, read.market),
    answer: read.answer && {
      ...read.answer,
      reasons: [...read.answer.reasons],
      sources: read.answer.sources.map((source) => ({ ...source })),
    },
    outcome: read.outcome && { ...read.outcome },
  };
}

/** The question a read on each market would answer is written here, once, from the domain rule. */
const toReadServiceDto = (service: DirectoryAgent["service"], venue: Venue): ReadServiceDto => ({
  ...service,
  markets: service.markets.map((name) => ({ name, question: readQuestion(venue, name) })),
});

export function toDirectoryAgentDto(entry: DirectoryAgent): DirectoryAgentDto {
  return {
    ...entry,
    agent: toActivityAgentDto(entry.agent),
    service: toReadServiceDto(entry.service, entry.venue),
  };
}

export function toAgentPersonaDto(persona: AgentPersona): AgentPersonaDto {
  return {
    ...persona,
    slug: agentSlug(persona.ticker),
    score: agentScore({
      calibrationGap: persona.calibrationGap,
      resolved: persona.resolved,
      net: persona.net,
    }),
    service: toReadServiceDto(persona.service, persona.venue),
    reads: persona.reads.map(toAgentReadDto),
    meters: persona.meters.map((meter) => ({ ...meter })),
    rules: [...persona.rules],
    brief: persona.brief.map((item) => ({ ...item })),
    answers: persona.answers.map((answer) => ({ ...answer })),
    decisions: persona.decisions.map(toActivityEventDto),
  };
}

export function toPlatformAnalyticsDto(analytics: PlatformAnalytics): PlatformAnalyticsDto {
  return {
    ...analytics,
    groups: analytics.groups.map((group) => ({
      label: group.label,
      cards: group.cards.map((card) => ({ ...card })),
    })),
    series: analytics.series.map((series) => ({
      ...series,
      from: series.from.toISOString(),
      to: series.to.toISOString(),
      points: series.points.map((point) => ({ ...point })),
    })),
    log: analytics.log.map(toActivityEventDto),
    table: analytics.table.map((row) => ({
      ...row,
      agent: toActivityAgentDto(row.agent),
      form: [...row.form],
    })),
  };
}

export function toLeaderboardDto(board: Leaderboard): LeaderboardDto {
  return {
    entries: board.entries.map((entry) => ({ ...entry, agent: toActivityAgentDto(entry.agent) })),
    weights: board.weights.map((weight) => ({ ...weight })),
    calibration: board.calibration.map((report) => ({
      ...report,
      agent: toActivityAgentDto(report.agent),
      points: report.points.map((point) => ({ ...point })),
    })),
  };
}
