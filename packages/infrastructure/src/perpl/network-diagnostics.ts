/** Allowlisted observations only: never retain messages, addresses, headers or raw causes. */
const stages = {
  ENOTFOUND: "dns",
  EAI_AGAIN: "dns",
  ECONNREFUSED: "connect",
  ENETUNREACH: "connect",
  EHOSTUNREACH: "connect",
  UND_ERR_CONNECT_TIMEOUT: "connect",
  CERT_HAS_EXPIRED: "tls",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls",
  SELF_SIGNED_CERT_IN_CHAIN: "tls",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "tls",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls",
  ERR_SSL_WRONG_VERSION_NUMBER: "tls",
  UND_ERR_HEADERS_TIMEOUT: "response_headers",
  UND_ERR_BODY_TIMEOUT: "response_body",
  ECONNRESET: "unknown",
  ETIMEDOUT: "unknown",
  EPIPE: "unknown",
  UND_ERR_SOCKET: "unknown",
} as const;
export interface NetworkFailure {
  stage: "dns" | "connect" | "tls" | "response_headers" | "response_body" | "unknown";
  codes: string[];
  termination: "error" | "timeout" | "cancelled";
}
export function networkFailure(
  error: unknown,
  termination: NetworkFailure["termination"] = "error",
): NetworkFailure {
  const codes = new Set<keyof typeof stages>();
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 4 || seen.size >= 16) {
      return;
    }
    seen.add(value);
    // Read only data properties: untrusted getters must not execute while diagnosing failures.
    const fields = Object.getOwnPropertyDescriptors(value);
    const code = fields.code?.value;
    if (typeof code === "string" && Object.hasOwn(stages, code)) {
      codes.add(code as keyof typeof stages);
    }
    visit(fields.cause?.value, depth + 1);
    const errors = fields.errors?.value;
    if (Array.isArray(errors)) {
      for (const child of errors.slice(0, 8)) {
        visit(child, depth + 1);
      }
    }
  };
  visit(error, 0);
  const known = new Set([...codes].map((code) => stages[code]));
  return {
    stage: known.size === 1 ? [...known][0]! : "unknown",
    codes: [...codes].sort(),
    termination,
  };
}
