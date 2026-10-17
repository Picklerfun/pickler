import type { StudioDirectory } from "../studio/access.js";
import type { AgentRecord, ScheduleReadiness, RunRecord } from "./types.js";
export type RunSummary = Omit<RunRecord, "config" | "decision"> & {
  resultAvailable: boolean;
  lastEventId: string | null;
};
export type ExecutionStatus = Omit<RunSummary, "agentId"> & { agentId: string | null };
export type ExecutionEvent = { id: string; type: string; createdAt: number } & (
  { data: unknown; oversized?: false } | { oversized: true; detailUrl: string }
);
export interface EventPage {
  items: ExecutionEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}
export interface ExecutionReads {
  studioIdentity(
    workspaceId: string,
    tenantId: string,
    productId: string,
  ): Promise<Awaited<ReturnType<StudioDirectory["list"]>>[number] | null>;
  previewResult(
    actorId: string,
    id: string,
    now: number,
  ): Promise<import("../studio/preview.js").PreviewRun>;
  studioRecords(
    tenantId: string,
    agentIds: string[],
  ): Promise<{ agent: AgentRecord; readiness: ScheduleReadiness }[]>;
  studioWallets(
    agentIds: string[],
  ): Promise<{ agentId: string; walletId: string; address: string }[]>;
  summaries(
    tenantId: string,
    agentId: string,
    query: { limit?: number | undefined; cursor?: string | undefined },
  ): Promise<{ items: RunSummary[]; nextCursor: string | null }>;
  status(
    kind: "research" | "preview",
    actorId: string,
    id: string,
    now: number,
  ): Promise<ExecutionStatus>;
  events(
    kind: "research" | "preview",
    actorId: string,
    id: string,
    query: { limit?: number | undefined; after?: string | undefined },
    now: number,
  ): Promise<EventPage>;
  event(
    kind: "research" | "preview",
    actorId: string,
    id: string,
    eventId: string,
    now: number,
  ): Promise<ExecutionEvent>;
}
