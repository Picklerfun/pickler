import { PilotError } from "@pickler/core";
import type { PerpsDataPolicy } from "./acquisition.js";
export interface PerplTransportChoice {
  version: 1;
  policy: PerpsDataPolicy;
  transport: "rest" | "websocket";
  restValid: number;
  websocketValid: number;
  reconstructionErrors: number;
  ownershipErrors: number;
  reason: string;
}
/** Frozen before public comparison. No economic/strategy inputs participate. */
export function choosePerplTransport(input: {
  restValid: number;
  websocketValid: number;
  reconstructionErrors: number;
  ownershipErrors: number;
  opportunities: number;
}): PerplTransportChoice {
  if (
    input.opportunities !== 10 ||
    ![
      input.restValid,
      input.websocketValid,
      input.reconstructionErrors,
      input.ownershipErrors,
    ].every((n) => Number.isInteger(n) && n >= 0) ||
    input.restValid > 10 ||
    input.websocketValid > 10
  ) {
    throw new PilotError("INVALID_INPUT", "Ten completed transport opportunities required");
  }
  const websocket =
    input.websocketValid >= 9 &&
    input.websocketValid > input.restValid &&
    input.reconstructionErrors === 0 &&
    input.ownershipErrors === 0;
  return {
    version: 1,
    policy: websocket ? "stream-20s-v1" : "rest-paced-20s-v1",
    transport: websocket ? "websocket" : "rest",
    restValid: input.restValid,
    websocketValid: input.websocketValid,
    reconstructionErrors: input.reconstructionErrors,
    ownershipErrors: input.ownershipErrors,
    reason: websocket
      ? "WebSocket passed 9/10, exceeded REST and had no reconstruction/ownership errors"
      : "WebSocket selection criteria not all satisfied; retain explicitly paced REST",
  };
}
