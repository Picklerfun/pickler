"use client";
import { useEffect } from "react";

const outcomes = new Set([
  "connected",
  "cancelled",
  "failed",
  "x_account_mismatch",
  "x_handle_taken",
  "x_revocation_pending",
]);
/** Only a result notification: the owner window rereads its authenticated API state. */
export function XOAuthReturn() {
  useEffect(() => {
    if (!["/", "/studio"].includes(window.location.pathname)) {
      return;
    }
    const query = new URLSearchParams(window.location.search);
    const outcome = query.get("xResult");
    const flow = query.get("xFlow");
    const agentId = query.get("agent");
    if (!outcome || !outcomes.has(outcome) || !flow || !/^[A-Za-z0-9_-]{43}$/.test(flow)) {
      return;
    }
    const result = { type: "pickler-x-oauth", agentId, outcome, flow };
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(`pickler-x-${flow}`);
      channel.onmessage = (event) => {
        if (event.data?.type === "received" && event.data?.flow === flow) {
          channel.close();
          window.close();
        }
      };
      channel.postMessage(result);
      return () => channel.close();
    }
    if (window.opener) {
      window.opener.postMessage(result, window.location.origin);
      window.close();
    }
  }, []);
  return null;
}
