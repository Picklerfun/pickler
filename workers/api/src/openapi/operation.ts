import { describeRoute, resolver } from "hono-openapi";
import type { DescribeRouteOptions } from "hono-openapi";
import { z } from "zod";
import { envelopeErrorSchema } from "@pickler/api-schema";

export type Security = "public" | "user" | "workspace" | "agent" | "apply";
export interface OperationOptions {
  response: z.ZodType;
  responseContent?: Record<string, z.ZodType>;
  body?: z.ZodType;
  optionalBody?: boolean;
  status?: number;
  also?: number[];
  redirect?: boolean;
  responseHeaders?: Record<string, { description: string; schema: { type: "string" } }>;
  security?: Security;
  description?: string;
  query?: Record<
    string,
    { required?: boolean; description?: string; schema?: Record<string, unknown> }
  >;
  /** Adds the Idempotency-Key header: required, or `"optional"`. */
  idempotent?: boolean | "optional";
  errors?: z.ZodType;
  errorStatuses?: number[];
  /** Request headers beyond the security and idempotency ones. */
  headers?: Record<string, { required?: boolean; description: string }>;
  /** Statuses with their own JSON body, documented after (and over) the error statuses. */
  responses?: Record<number, { description: string; schema: z.ZodType }>;
}

/** Documentation only: existing handler validation and authorization remain authoritative. */
export function operation(id: string, options: OperationOptions) {
  const security = options.security ?? "public";
  const requirements = {
    public: [],
    user: [{ bearerAuth: [] }],
    workspace: [{ bearerAuth: [] }, { apiKey: [] }, { apiKeyAuthorization: [] }],
    agent: [
      { bearerAuth: [] },
      { apiKey: [] },
      { apiKeyAuthorization: [] },
      { agentId: [], agentSignature: [], agentTimestamp: [] },
    ],
    apply: [{ applyCookie: [] }],
  };
  const response = {
    description: "Successful response",
    ...(options.redirect
      ? {}
      : {
          content: Object.fromEntries(
            Object.entries(options.responseContent ?? { "application/json": options.response }).map(
              ([type, schema]) => [type, { schema: resolver(schema) }],
            ),
          ),
        }),
    ...(options.redirect || options.responseHeaders
      ? {
          headers: {
            ...(options.redirect
              ? {
                  Location: {
                    description: "Same-origin Studio return",
                    schema: { type: "string" as const },
                  },
                }
              : {}),
            ...options.responseHeaders,
          },
        }
      : {}),
  };
  const responses: NonNullable<DescribeRouteOptions["responses"]> = {};
  for (const status of [options.status ?? 200, ...(options.also ?? [])]) {
    responses[status] = response;
  }
  const defaultErrors =
    security === "public" ? [400, 500, 503] : [400, 401, 403, 404, 409, 500, 503];
  for (const status of options.errorStatuses ?? defaultErrors) {
    responses[status] = {
      description: "Request refused or service unavailable; see the response code/message",
      content: { "application/json": { schema: resolver(options.errors ?? envelopeErrorSchema) } },
    };
  }
  for (const [status, special] of Object.entries(options.responses ?? {})) {
    responses[status] = {
      description: special.description,
      content: { "application/json": { schema: resolver(special.schema) } },
    };
  }
  const parameters: NonNullable<DescribeRouteOptions["parameters"]> = Object.entries(
    options.query ?? {},
  ).map(([name, field]) => ({
    name,
    in: "query",
    required: field.required ?? false,
    ...(field.description ? { description: field.description } : {}),
    schema: field.schema ?? { type: "string" },
  }));
  if (security === "workspace" || security === "agent") {
    parameters.push({
      name: "X-Integrator-Id",
      in: "header",
      required: false,
      description:
        "Select an authorized workspace. Requires the agent module and read Agent permission.",
      schema: { type: "string" },
    });
  }
  for (const [name, header] of Object.entries(options.headers ?? {})) {
    parameters.push({
      name,
      in: "header",
      required: header.required ?? false,
      description: header.description,
      schema: { type: "string" },
    });
  }
  if (options.idempotent) {
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: options.idempotent !== "optional",
      schema: { type: "string", minLength: 1, maxLength: 200 },
    });
  }
  return describeRoute({
    operationId: (route) =>
      `${id}${route.path.startsWith("/v1/console") ? "ConsoleAlias" : route.path.startsWith("/v1/demo") ? "DemoAlias" : ""}`,
    summary: id.replace(/([A-Z])/g, " $1").trim(),
    ...(options.description ? { description: options.description } : {}),
    tags: [id.split(/(?=[A-Z])/)[0]!],
    security: requirements[security],
    parameters,
    responses,
    ...(options.body
      ? {
          requestBody: {
            required: !options.optionalBody,
            content: { "application/json": { schema: resolver(options.body) } },
          },
        }
      : {}),
  });
}
