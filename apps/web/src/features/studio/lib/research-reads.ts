import type { EventPageDto, RunSummaryDto } from "@pickler/api-schema";
import type { Run, RunEvent } from "../api";
type Request = <T>(path: string, signal: AbortSignal) => Promise<T>;
/** One owner/agent view owns this reader; navigation discards results and private cursors. */
export function researchReads(request: Request, clock = Date.now) {
  let listed: Run[] = [];
  let discovered = -Infinity;
  let nextCursor: string | null = null;
  let olderRead = false;
  const headGaps: string[] = [];
  const cursor = () => headGaps[0] ?? nextCursor;
  const ordered = (items: Run[]) =>
    items.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  const details = new Map<string, Run>();
  const traces = new Map<string, { after: string; events: RunEvent[] }>();
  return {
    async list(agentId: string, signal: AbortSignal) {
      if (clock() - discovered >= 20000) {
        const page = await request<{ items: RunSummaryDto[]; nextCursor: string | null }>(
          `/agents/${encodeURIComponent(agentId)}/runs`,
          signal,
        );
        if (signal.aborted) {
          return { runs: [] as Run[], nextCursor };
        }
        const newest = page.items.map((item) => ({
          ...item,
          agentId: item.agentId!,
          decision: details.get(item.id)?.decision ?? null,
        }));
        const previousIds = new Set(listed.map((item) => item.id));
        if (
          olderRead &&
          listed.length &&
          page.nextCursor &&
          !newest.some((item) => previousIds.has(item.id))
        ) {
          headGaps.unshift(page.nextCursor);
        }
        const ids = new Set(newest.map((item) => item.id));
        listed = ordered([...newest, ...listed.filter((item) => !ids.has(item.id))]);
        if (!olderRead) {
          nextCursor = page.nextCursor;
        }
        discovered = clock();
      }
      return { runs: listed, nextCursor: cursor() };
    },
    async older(agentId: string, signal: AbortSignal) {
      const currentCursor = cursor();
      if (!currentCursor) {
        return { runs: listed, nextCursor: cursor() };
      }
      const page = await request<{ items: RunSummaryDto[]; nextCursor: string | null }>(
        `/agents/${encodeURIComponent(agentId)}/runs?cursor=${encodeURIComponent(currentCursor)}`,
        signal,
      );
      if (signal.aborted) {
        return { runs: listed, nextCursor: cursor() };
      }
      const ids = new Set(listed.map((item) => item.id));
      const bridged = page.items.some((item) => ids.has(item.id));
      listed = ordered([
        ...listed,
        ...page.items
          .filter((item) => !ids.has(item.id))
          .map((item) => ({
            ...item,
            agentId: item.agentId!,
            decision: details.get(item.id)?.decision ?? null,
          })),
      ]);
      if (headGaps.length) {
        if (bridged || !page.nextCursor) {
          headGaps.shift();
        } else {
          headGaps[0] = page.nextCursor;
        }
      } else {
        nextCursor = page.nextCursor;
      }
      olderRead = true;
      return { runs: listed, nextCursor: cursor() };
    },
    async selected(id: string, signal: AbortSignal) {
      let current = listed.find((item) => item.id === id);
      if (!current || current.status === "queued" || current.status === "running") {
        const status = await request<RunSummaryDto>(
          `/runs/${encodeURIComponent(id)}/status`,
          signal,
        );
        current = {
          ...status,
          agentId: status.agentId!,
          decision: details.get(id)?.decision ?? null,
        };
      }
      if (current.resultAvailable && !details.has(id)) {
        const detail = await request<Run>(`/runs/${encodeURIComponent(id)}`, signal);
        if (!signal.aborted) {
          details.set(id, detail);
        }
      }
      const result = details.get(id) ?? current;
      listed = listed.map((item) => (item.id === id ? result : item));
      return result;
    },
    async events(id: string, signal: AbortSignal) {
      const trace = traces.get(id) ?? { after: "0", events: [] };
      let more = true;
      while (more && !signal.aborted) {
        const page = await request<EventPageDto>(
          `/runs/${encodeURIComponent(id)}/events?after=${trace.after}`,
          signal,
        );
        if (signal.aborted) {
          break;
        }
        const ids = new Set(trace.events.map((event) => String(event.id)));
        for (const event of page.items) {
          if (!ids.has(event.id)) {
            trace.events.push({
              id: event.id,
              type: event.type,
              createdAt: event.createdAt,
              data:
                "oversized" in event && event.oversized
                  ? { oversized: true, detailUrl: event.detailUrl }
                  : "data" in event
                    ? event.data
                    : null,
            });
          }
        }
        if (page.hasMore && (!page.nextCursor || page.nextCursor === trace.after)) {
          throw new Error("Event cursor did not advance");
        }
        trace.after = page.nextCursor ?? trace.after;
        more = page.hasMore;
      }
      if (!signal.aborted) {
        traces.set(id, trace);
      }
      return { events: trace.events };
    },
  };
}
