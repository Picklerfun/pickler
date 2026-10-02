import type { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import type { AppEnv } from "../env";

export async function apiDocument(app: Hono<AppEnv>) {
  const document = await generateSpecs(app, {
    excludeStaticFile: false,
    documentation: {
      openapi: "3.1.0",
      info: {
        title: "Pickler API",
        version: "1.0.0",
        description:
          "Existing product API. Documentation is public; operation authorization remains mandatory. Recommendations not implemented here are not advertised.",
      },
      servers: [
        {
          url: "/api",
          description:
            "Web host proxy for /v1 operations. /health is the private Worker's liveness route, not a web-proxied endpoint.",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
          apiKeyAuthorization: {
            type: "apiKey",
            in: "header",
            name: "Authorization",
            description: "ApiKey <key>",
          },
          agentId: { type: "apiKey", in: "header", name: "x-agent-id" },
          agentSignature: {
            type: "apiKey",
            in: "header",
            name: "x-agent-auth",
            description: "Agent HMAC; self-access only",
          },
          agentTimestamp: {
            type: "apiKey",
            in: "header",
            name: "x-request-timestamp",
            description: "Signed timestamp, ±60 seconds",
          },
          applyCookie: {
            type: "apiKey",
            in: "cookie",
            name: "pk_apply",
            description: "HttpOnly application seat cookie issued by waitlist",
          },
        },
      },
    },
  });
  for (const [path, item] of Object.entries(document.paths)) {
    const canonical = path
      .replace(/^\/v1\/console(?=\/|$)/, "/v1/studio")
      .replace(/^\/v1\/demo(?=\/|$)/, "/v1/marketplace");
    if (canonical !== path && item) {
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        const entry = item[method];
        if (entry) {
          entry.description = `${entry.description ?? ""} Compatibility alias of ${canonical}.`;
        }
      }
    }
  }
  if (document.paths["/health"]) {
    document.paths["/health"].servers = [{ url: "/", description: "Direct Worker only" }];
  }
  return document;
}
