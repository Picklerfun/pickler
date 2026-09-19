// Ported from Relayer apps/api/src/kits/agent/guards/agent-auth.guard.ts (commit bb6bb1226e92).
// The signing contract is unchanged so existing @relayerfi/agent-sdk clients keep working:
//   payload   = METHOD + path + timestamp + sha256hex(bodyString)
//   bodyString = JSON.stringify(parsedBody) when the body is a non-empty JSON object, else ""
//   signature = hex(HMAC-SHA256(agentSecret, payload)), timestamp in unix seconds, ±60 s window.
// Behaviour changes: every failure uses the same "Invalid agent credentials" response except the
// documented `expired_timestamp` and `agent_killed` codes, and malformed hex never throws.

import { buildAgentPrincipal, type AgentPrincipal } from "../../access/domain/principal.js";
import type { AgentRegistry } from "../ports/agent-registry.js";

export const AGENT_AUTH_WINDOW_SECONDS = 60;

export type AgentAuthFailure = "invalid_auth" | "expired_timestamp" | "agent_killed";

export class AgentAuthenticationError extends Error {
  constructor(
    readonly code: AgentAuthFailure,
    message: string,
  ) {
    super(message);
    this.name = "AgentAuthenticationError";
  }
}

export interface AgentRequest {
  agentId: string | null;
  signature: string | null;
  timestamp: string | null;
  method: string;
  /** URL pathname including the /v1 prefix, without the query string. */
  path: string;
  /** Raw request body text ("" when absent). */
  body: string;
}

export interface AgentAuthDependencies {
  agents: AgentRegistry;
  decryptSecret(ciphertext: string): Promise<string>;
  sha256Hex(value: string): Promise<string>;
  hmacSha256Hex(key: string, message: string): Promise<string>;
  now(): Date;
}

/** Mirrors Express body parsing + JSON.stringify so signatures computed by the SDK still match. */
export function canonicalBody(raw: string): string {
  if (!raw) {
    return "";
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && Object.keys(parsed).length > 0
      ? JSON.stringify(parsed)
      : "";
  } catch {
    return "";
  }
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const left = a.toLowerCase();
  if (left.length !== b.length || !/^[0-9a-f]*$/.test(left)) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function createAuthenticateAgent(deps: AgentAuthDependencies) {
  const invalid = () => new AgentAuthenticationError("invalid_auth", "Invalid agent credentials");

  return async (request: AgentRequest): Promise<AgentPrincipal> => {
    if (!request.agentId || !request.signature || !request.timestamp) {
      throw new AgentAuthenticationError("invalid_auth", "Missing required agent auth headers");
    }
    const ts = Number.parseInt(request.timestamp, 10);
    const nowSeconds = Math.floor(deps.now().getTime() / 1000);
    if (Number.isNaN(ts) || Math.abs(nowSeconds - ts) > AGENT_AUTH_WINDOW_SECONDS) {
      throw new AgentAuthenticationError(
        "expired_timestamp",
        "Request timestamp outside acceptable window",
      );
    }

    const agent = await deps.agents.findCredentials(request.agentId);
    if (!agent || !agent.encryptedAgentSecret) {
      throw invalid();
    }
    if (agent.status === "killed") {
      throw new AgentAuthenticationError("agent_killed", "Agent has been terminated");
    }

    let secret: string;
    try {
      secret = await deps.decryptSecret(agent.encryptedAgentSecret);
    } catch {
      throw invalid();
    }

    const payload = `${request.method.toUpperCase()}${request.path}${request.timestamp}${await deps.sha256Hex(canonicalBody(request.body))}`;
    const expected = await deps.hmacSha256Hex(secret, payload);
    if (!constantTimeEqualHex(request.signature, expected)) {
      throw invalid();
    }

    return buildAgentPrincipal({
      id: agent.id,
      integrator_id: agent.workspaceId,
      wallet_id: agent.walletId,
      status: agent.status,
    });
  };
}
