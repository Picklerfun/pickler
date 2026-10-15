import type { PerplLiveStateDto, PerplMarketCatalogDto } from "@pickler/api-schema";
import type { ActionButtonState, IconName } from "@pickler/ui";

export type PerplOrder = PerplLiveStateDto["orders"][number];
export type PerplPosition = PerplLiveStateDto["positions"][number];

export function amount(value: string | null | undefined) {
  return value == null ? "—" : value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
export function timestamp(value: string) {
  return `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
export function sessionRunning(state: PerplLiveStateDto | null) {
  return (
    !!state?.session && ["active", "paused", "stopping", "frozen"].includes(state.session.status)
  );
}
export function accountObserved(state: PerplLiveStateDto | null) {
  return !!state?.available && !state.setupRequired && !!state.observedAt;
}

/** Presentation precedence only: a missing read never establishes readiness or a flat account. */
export function perplStatus(
  state: PerplLiveStateDto | null,
  readError = "",
): { label: string; tone: "good" | "caution"; icon: IconName } {
  if (readError) {
    return { label: "Check connection", tone: "caution", icon: "alert" };
  }
  if (!state) {
    return { label: "Reading account", tone: "caution", icon: "refresh" };
  }
  if (!state.available) {
    return { label: "Trading unavailable", tone: "caution", icon: "lock" };
  }
  if (state.setupRequired) {
    return { label: "Connect account", tone: "caution", icon: "key" };
  }
  const status = state.session?.status;
  if (status === "frozen") {
    return { label: "Review required", tone: "caution", icon: "alert" };
  }
  if (status === "stopping") {
    return { label: "Closing positions", tone: "caution", icon: "clock" };
  }
  if (status === "paused" || !state.admissionsEnabled) {
    return { label: "Entries paused", tone: "caution", icon: "pause" };
  }
  if (status === "active") {
    return { label: "Trading", tone: "good", icon: "activity" };
  }
  if (!accountObserved(state)) {
    return { label: "Reading account", tone: "caution", icon: "refresh" };
  }
  return { label: "Ready to trade", tone: "good", icon: "check" };
}

export const orderLabels: Record<PerplOrder["status"], string> = {
  prepared: "Queued",
  dispatching: "Sending",
  unknown: "Checking submission",
  accepted: "Submitted",
  filled: "Confirmed fill",
  partial: "Partially filled",
  rejected: "Refused",
  cancelled: "Cancelled",
  expired: "Expired",
};
export function orderIcon(order: PerplOrder): IconName {
  if (order.status === "filled") {
    return "check";
  }
  if (["rejected", "cancelled", "expired", "unknown"].includes(order.status)) {
    return "alert";
  }
  return "clock";
}
export function sessionFeedback(
  state: PerplLiveStateDto | null,
  starting: boolean,
): { state: ActionButtonState; label: string; hint?: string; busy: boolean } {
  if (starting) {
    return {
      state: "working",
      label: "Starting trading…",
      hint: "Sending your session request",
      busy: true,
    };
  }
  const session = state?.session;
  if (!session || !sessionRunning(state)) {
    return { state: "ready", label: "Start trading", busy: false };
  }
  const orders = state.orders
    .filter((order) => order.sessionId === session.id)
    .sort((a, b) => b.requestId - a.requestId);
  const latest = orders[0];
  if (session.status === "frozen" || latest?.status === "unknown") {
    return {
      state: "unknown",
      label: "Review trading status",
      hint: "The saved request will not be repeated",
      busy: false,
    };
  }
  if (session.status === "stopping") {
    return {
      state: "waiting",
      label: "Closing position…",
      hint: "Waiting for a confirmed fill",
      busy: true,
    };
  }
  if (session.status === "paused") {
    return {
      state: "waiting",
      label: "Entries paused",
      hint: "Existing exits remain active",
      busy: false,
    };
  }
  if (latest?.status === "filled" && latest.action.startsWith("open")) {
    return {
      state: "success",
      label: "Position confirmed",
      hint: "Waiting for the target close",
      busy: false,
    };
  }
  if (latest?.status === "partial") {
    return {
      state: "waiting",
      label: "Partially filled",
      hint: "Following the remaining execution",
      busy: true,
    };
  }
  const closing = latest?.action.startsWith("close");
  return {
    state: "waiting",
    label: closing ? "Closing position…" : "Opening position…",
    hint: latest ? orderLabels[latest.status] : "Session queued · awaiting an order",
    busy: true,
  };
}

export interface PerplCycle {
  id: string;
  sessionId: string;
  symbol: string;
  orders: PerplOrder[];
}
/** Pair chronological executions within their own session and market, preserving every order. */
export function groupCycles(orders: PerplOrder[]): PerplCycle[] {
  const groups: PerplCycle[] = [];
  const current = new Map<string, PerplCycle>();
  const sorted = [...orders].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.requestId - b.requestId ||
      a.id.localeCompare(b.id),
  );
  for (const order of sorted) {
    const key = `${order.sessionId}:${order.symbol}`;
    let group = current.get(key);
    if (
      !group ||
      (order.action.startsWith("open") &&
        group.orders.some((row) => row.action.startsWith("close")))
    ) {
      group = { id: order.id, sessionId: order.sessionId, symbol: order.symbol, orders: [] };
      groups.push(group);
      current.set(key, group);
    }
    group.orders.push(order);
  }
  return groups.reverse();
}

/** Catalogue rows describe venue availability; the saved agent allowlist still gates selection. */
export function executionMarketOptions(
  catalog: PerplMarketCatalogDto | null,
  configured: readonly string[],
) {
  const rows = catalog?.markets ?? [];
  return rows.map((row, index) => {
    const symbol = row.symbol;
    const unique = symbol !== null && rows.filter((item) => item.symbol === symbol).length === 1;
    const configuredMarket = symbol !== null && configured.includes(symbol);
    const enabled = unique && row.available && configuredMarket;
    let reason = "";
    if (!unique) {
      reason = "Market identity unavailable";
    } else if (!row.available) {
      reason = row.reasons.join("; ") || row.status;
    } else if (!configuredMarket) {
      reason = "Enable in Sources & rules";
    }
    return {
      value: enabled && symbol !== null ? symbol : `unavailable-${row.marketId ?? index}-${index}`,
      symbol,
      name: row.name,
      enabled,
      reason,
    };
  });
}
