// Ported from Relayer apps/api/src/api/dtos/api-response.dto.ts and api/utils/response.helper.ts
// (commit bb6bb1226e92). Same JSON shape, so clients and the agent SDK that parse Relayer's
// envelope keep working.

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data?: T;
  statusCode: number;
  timestamp: string;
  path?: string;
  traceId?: string;
  /** Structured error metadata that SDKs branch on. */
  error?: string;
  code?: string;
  reason?: string;
  detail?: string;
}

export interface ErrorExtras {
  error?: string;
  code?: string;
  reason?: string;
  detail?: string;
}

export function successEnvelope<T>(
  data: T,
  path: string,
  message = "Success",
  statusCode = 200,
): ApiEnvelope<T> {
  return { success: true, message, data, statusCode, timestamp: new Date().toISOString(), path };
}

export function errorEnvelope(
  message: string,
  statusCode: number,
  path: string,
  traceId?: string,
  extras?: ErrorExtras,
): ApiEnvelope<never> {
  return {
    success: false,
    message,
    statusCode,
    timestamp: new Date().toISOString(),
    path,
    ...(traceId ? { traceId } : {}),
    ...(extras ?? {}),
  };
}
